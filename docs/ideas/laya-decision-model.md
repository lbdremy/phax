# Idea: Laya as a fast decision model inside phax — **not pursued**

> Status: **declined**. Evaluated 2026-10-01 against `main` at `beb25346`. Kept so the
> question is not re-opened from scratch: no use case was found where Laya improves phax.
>
> Related: [`local-and-cloud-modes.md`](./local-and-cloud-modes.md) (the only other place a
> non-CLI backend is discussed), [`autopilot.md`](./autopilot.md) (a "decision answerer
> with a policy" — the nearest consumer a decision model could have had).

## What Laya is

[Laya](https://laya.convaiinnovations.com/) is an open-source (Apache 2.0),
non-autoregressive decision model: a bidirectional encoder (ModernBERT-large /
mmBERT-base, 322–421M parameters) that returns calibrated probabilities over a predefined
schema instead of generating text. Three primitives — `choice` (pick one option), `score`
(ordinal rubric), `noul` (calibrated boolean) — answered in one forward pass, in tens of
milliseconds on a GPU. Python package (`pip install laya`), self-hosted.

Its own stated limits decide most of what follows: zero-shot accuracy is weak (about 0.35),
so it needs fine-tuning on labelled examples; context is 512–1024 tokens (8k for the
multilingual checkpoint); `choice` degrades beyond about 20 options.

## The question

Laya can only do pick-one, ordinal-score and yes/no decisions. So: which of phax's
decisions have that shape, who makes them today, and is there labelled data to train on?

## What the inventory showed

Almost every such decision in phax is deterministic code or a value the planner writes
into `plan.md`: routing resolution, gate verdicts, the fix-loop counter, rate-limit
classification, file reconciliation, staleness, overlap severity, lint, security mode.
Replacing any of these with a probabilistic model would trade determinism — the product's
premise — for nothing.

Only three decisions go to an LLM: the compliance verdict, plan extraction (only when the
parser fails) and handoff authoring. Each needs the whole plan, the handoffs or the
worktree — far beyond Laya's context — and two of the three produce prose, which Laya
cannot emit.

## Candidates considered

| Candidate | Why not |
| --- | --- |
| Advisory model/effort check on a plan phase (via the `planAuditor` external command) | The only plausible fit: small input, small fixed outputs, about 423 phase declarations in `docs/plans/`. But those labels are the planner's choice, not evidence the choice was right; most name a superseded model id; and the planner already makes this choice for free while writing the plan. A second opinion, not a saving. |
| Classify gate failures (flaky vs real, retry vs escalate) | Today a counter (`maxFixAttempts`). No labels exist, and gate logs are unbounded. |
| Compliance verdict | Input is the whole plan, every handoff and the worktree. |
| "Did the handoff explain this deviation?" | Fits the size, but it is a substring check that only logs a warning, and nothing is persisted to train on. |
| Staleness materiality ("does this ground change matter?") | Puts a probabilistic model in front of a gate that refuses to run, and needs diffs as input. |
| Answering spec open questions, review severity (`artifact decide`, `review-plan`) | Need reasoning over options and their losses, not classification; about 11 JSON sidecars of examples. |

## Cost of adopting it at all

phax has no Python, no HTTP client and no local-model provider; `ProviderId` is a closed
set of three agent CLIs. Laya would have to live outside the repo as a user-supplied
command, with a fine-tuned checkpoint someone trains and maintains, on a GPU the user
provides.

## Decision

Not used. No use case improves phax: the decisions Laya could take are already
deterministic, and the ones an LLM takes do not fit it.

## What would re-open it

Outcome-labelled data. If the records branch (`phax/records/v1`) is switched on and shows
that declared tier and effort correlate with phase outcome (committed vs failed, token
cost), the advisory model/effort check has something real to learn from. Even then, try a
plain statistic over the records before a fine-tuned model.
