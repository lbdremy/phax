---
name: state-machines
description: Transition RunState and PhaseState only through the explicit functions in src/domain/state.ts — never mutate state-bearing fields directly.
---

# State machines

## The rule

**`RunState` and `PhaseState` transitions must go through the explicit
transition functions in `src/domain/state.ts`.** Direct assignment or mutation
of state-bearing fields outside that module is a violation.

## State shapes

```typescript
// src/domain/state.ts
type RunState =
  | "created"
  | "running"
  | "failed"
  | "review_open"
  | "completed"
  | "stopped"
  | "archived"
  | "interrupted";

type PhaseState =
  | "pending"
  | "setting_up_worktree"
  | "running"
  | "gates_failed"
  | "fixing"
  | "failed"
  | "passed"
  | "committed"
  | "cleaning_up"
  | "cleaned_up"
  | "review_open"
  | "handoff_failed"
  | "skipped";
```

## Transition functions

Each transition function takes the current state and returns
`Either<NewState, InvalidTransitionError>`. Call-sites must handle the `Left`
(invalid transition) case.

```typescript
import { startRun, failRun, openRunReview } from "../domain/state.js";
import { Either } from "effect";

const next = startRun(currentState);
if (Either.isLeft(next)) {
  // surface InvalidTransitionError — never silently swallow it
}
```

## Why

Direct string assignment bypasses the transition guard. This means illegal
state sequences (e.g., `archived → running`) become possible, which corrupts
`registry.json` and `run-status.json` in ways that are hard to detect.

The `Either`-returning pattern forces callers to handle illegal transitions
explicitly rather than producing silent corrupt state.

## How to fix a violation

1. Find the direct state field assignment (e.g., `status.runState = "running"`).
2. Replace with the appropriate transition function from `src/domain/state.ts`.
3. Handle the `Left` case and surface the `InvalidTransitionError`.

## Audit rule

`PHAX_STATE_001` — direct assignment to a state-bearing type field detected
outside `domain/state.ts`.
