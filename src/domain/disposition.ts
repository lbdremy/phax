import type { PhaxCommand } from "./effects.js";

interface Handled<S> {
  readonly kind: "Handled";
  readonly nextState: S;
  readonly effects: readonly PhaxCommand[];
}

interface Ignored {
  readonly kind: "Ignored";
  readonly reason: string;
}

interface Stale {
  readonly kind: "Stale";
  readonly reason: string;
}

interface Rejected {
  readonly kind: "Rejected";
  readonly reason: string;
}

interface Unexpected {
  readonly kind: "Unexpected";
  readonly reason: string;
}

export type Disposition<S> = Handled<S> | Ignored | Stale | Rejected | Unexpected;

export type DispositionKind = Disposition<unknown>["kind"];

// Compile-time matrix: every (state, event) pair must have an explicit
// disposition kind. Phase-02 uses this with `satisfies` to force the reducer
// to interpret every signal — the doctrine's audit rule.
export type EventDispositionMatrix<S extends string, E extends string> = {
  readonly [stateName in S]: { readonly [eventType in E]: DispositionKind };
};
