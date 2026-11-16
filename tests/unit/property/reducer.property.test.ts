// The run reducer's five state-machine promises (§5.11 to §5.15), checked over its reachable
// states and every event type. They read `interpret` in src/domain/reducer.ts, never the
// deprecated transition functions of src/domain/state.ts, and never a reason's wording.
import * as fc from "fast-check";
import { describe, it } from "vitest";
import { interpret } from "../../../src/domain/reducer.js";
import { TERMINAL_PHASE_STATES } from "../../../src/domain/state.js";
import type { PhaseSubStateName, PhaxState } from "../../../src/domain/state.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";
import {
  anyEvent,
  reachableStates,
  statesOfRun,
  terminalPhaseStates,
} from "../../helpers/property/reducerInputs.js";

const DISPOSITION_KINDS: ReadonlySet<string> = new Set([
  "Handled",
  "Ignored",
  "Stale",
  "Rejected",
  "Unexpected",
]);

// q-terminal-successors, decided no-going-back: from a terminal phase state a handled event leads
// to no phase, to a terminal phase state, to a post-commit state or to the next phase's start.
// Terminal phase states themselves are checked through TERMINAL_PHASE_STATES.
const ALLOWED_AFTER_TERMINAL: ReadonlySet<PhaseSubStateName> = new Set<PhaseSubStateName>([
  // post-commit work: committed leads to cleanup, a failed handoff or a held review
  "cleaning_up",
  "handoff_failed",
  "awaiting_review",
  // the next phase's start: a reset or the next PhaseStartRequested
  "pending",
  "setting_up_worktree",
]);

const phaseOf = (state: PhaxState): PhaseSubStateName | undefined =>
  "phase" in state ? state.phase.state : undefined;

const goesBack = (next: PhaxState): boolean => {
  const phase = phaseOf(next);
  return (
    phase !== undefined && !TERMINAL_PHASE_STATES.has(phase) && !ALLOWED_AFTER_TERMINAL.has(phase)
  );
};

describe("run reducer", () => {
  it(
    "every state and event gets a disposition",
    () => {
      checkProperty(fc.tuple(reachableStates(), anyEvent()), ([{ state }, event]) => {
        const disposition = interpret(state, event);
        if (!DISPOSITION_KINDS.has(disposition.kind)) return false;
        return disposition.kind !== "Handled"
          ? true
          : disposition.nextState !== undefined && Array.isArray(disposition.effects);
      });
    },
    propertyTimeout(),
  );

  it(
    "an archived run handles nothing",
    () => {
      checkProperty(
        fc.tuple(statesOfRun("archived"), anyEvent()),
        ([{ state }, event]) => interpret(state, event).kind !== "Handled",
      );
    },
    propertyTimeout(),
  );

  it(
    "a completed or stopped run only archives",
    () => {
      checkProperty(
        fc.tuple(statesOfRun("completed", "stopped"), anyEvent()),
        ([{ state }, event]) => {
          const disposition = interpret(state, event);
          if (disposition.kind !== "Handled") return true;
          const next = disposition.nextState;
          return Object.keys(next).length === 1 && next.run === "archived";
        },
      );
    },
    propertyTimeout(),
  );

  it(
    "a terminal phase does not go back",
    () => {
      checkProperty(fc.tuple(terminalPhaseStates(), anyEvent()), ([{ state }, event]) => {
        const disposition = interpret(state, event);
        return disposition.kind !== "Handled" || !goesBack(disposition.nextState);
      });
    },
    propertyTimeout(),
  );

  it(
    "a refused event carries no change",
    () => {
      checkProperty(fc.tuple(reachableStates(), anyEvent()), ([{ state }, event]) => {
        const disposition = interpret(state, event);
        if (disposition.kind === "Handled") return true;
        const keys = Object.keys(disposition).toSorted();
        return keys.length === 2 && keys[0] === "kind" && keys[1] === "reason";
      });
    },
    propertyTimeout(),
  );
});
