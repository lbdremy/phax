// In-phase checks of the reducer's generators: every event type has a generator that builds a
// well-formed event, every run state and phase sub-state has a shape or a filler, and the reviewed
// table of reachable shapes is the reducer's own closure.
import { Result } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decodeClaudeSessionId,
  decodePhaseId,
  decodeRunId,
  decodeWorktreePath,
} from "../../../src/domain/branded.js";
import type { PhaxEvent, PhaxEventType } from "../../../src/domain/events.js";
import { phaxDispositionMatrix } from "../../../src/domain/matrix.js";
import { interpret } from "../../../src/domain/reducer.js";
import { TERMINAL_PHASE_STATES } from "../../../src/domain/state.js";
import { PhaseStatusFileSchema } from "../../../src/schemas/status.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";
import {
  EVENT_GENERATORS,
  PHASE_SUB_STATE_FILLERS,
  REACHABILITY_SEEDS,
  REACHABLE_SHAPES,
  anyEvent,
  missingEventGenerators,
  reachableStates,
  reducerClosure,
  shapeKey,
  shapeOf,
  statesOfRun,
  terminalPhaseStates,
} from "../../helpers/property/reducerInputs.js";

// The seed of the closure sample: fixed, so the table check is reproducible.
const CLOSURE_SEED = 20_261_116;
const SAMPLES_PER_EVENT_TYPE = 30;

const eventTypes = Object.keys(phaxDispositionMatrix.created);
const runStates = Object.keys(phaxDispositionMatrix);
const phaseSubStateNames = PhaseStatusFileSchema.fields.state.members.map(
  (member) => member.literal,
);

describe("event generators", () => {
  it.each(eventTypes)("%s has a generator", (type) => {
    expect(missingEventGenerators([type]), `no generator registered for ${type}`).toEqual([]);
  });

  it("no generator is registered for an event type the matrix does not know", () => {
    expect(Object.keys(EVENT_GENERATORS).filter((type) => !eventTypes.includes(type))).toEqual([]);
    expect(missingEventGenerators(["NotAnEvent"])).toEqual(["NotAnEvent"]);
  });

  it(
    "every generated event is well-formed for its type",
    () => {
      const typed = fc
        .constantFrom(...(eventTypes as PhaxEventType[]))
        .chain((type) => EVENT_GENERATORS[type].map((e): [PhaxEventType, PhaxEvent] => [type, e]));
      checkProperty(typed, ([type, e]) => {
        const fields = e as unknown as Readonly<Record<string, unknown>>;
        const decodes = (field: string, decode: (u: unknown) => Result.Result<unknown, unknown>) =>
          fields[field] === undefined || Result.isSuccess(decode(fields[field]));
        return (
          e.type === type &&
          decodes("run", decodeRunId) &&
          decodes("phase", decodePhaseId) &&
          decodes("phaseId", decodePhaseId) &&
          decodes("worktreePath", decodeWorktreePath) &&
          decodes("path", decodeWorktreePath) &&
          decodes("sessionId", decodeClaudeSessionId)
        );
      });
    },
    propertyTimeout(),
  );

  it(
    "any event of any shape is interpreted without throwing",
    () => {
      checkProperty(
        fc.tuple(reachableStates(), anyEvent()),
        ([{ state }, e]) => interpret(state, e).kind.length > 0,
      );
    },
    propertyTimeout(),
  );
});

describe("state generators", () => {
  it.each(runStates)("%s has a reachable shape", (run) => {
    expect(REACHABLE_SHAPES.some((shape) => shape.run === run)).toBe(true);
  });

  it.each(phaseSubStateNames)("%s has a filler", (name) => {
    expect(Object.hasOwn(PHASE_SUB_STATE_FILLERS, name)).toBe(true);
  });

  it("the reachable-shape table is the reducer's closure", () => {
    const events = Object.values(EVENT_GENERATORS).flatMap((generator) =>
      fc.sample(generator as fc.Arbitrary<PhaxEvent>, {
        numRuns: SAMPLES_PER_EVENT_TYPE,
        seed: CLOSURE_SEED,
      }),
    );
    const closure = new Set(
      reducerClosure(
        REACHABILITY_SEEDS.map((seed) => seed.state),
        events,
      ).map(shapeKey),
    );
    const table = new Set(REACHABLE_SHAPES.map(shapeKey));
    const missing = [...closure].filter((key) => !table.has(key)).toSorted();
    const extra = [...table].filter((key) => !closure.has(key)).toSorted();
    expect(
      { missing, extra },
      `the table lacks [${missing.join(", ")}] and has extra [${extra.join(", ")}]`,
    ).toEqual({ missing: [], extra: [] });
  });

  it(
    "every generated state has a reachable shape",
    () => {
      const keys = new Set(REACHABLE_SHAPES.map(shapeKey));
      checkProperty(
        reachableStates(),
        ({ origin, state }) => keys.has(shapeKey(shapeOf(state))) && keys.has(origin),
      );
    },
    propertyTimeout(),
  );

  it(
    "a source restricted to run states yields only those",
    () => {
      checkProperty(statesOfRun("running", "interrupted"), ({ state }) =>
        ["running", "interrupted"].includes(state.run),
      );
    },
    propertyTimeout(),
  );

  it(
    "the terminal source holds only terminal phase states",
    () => {
      checkProperty(
        terminalPhaseStates(),
        ({ state }) => "phase" in state && TERMINAL_PHASE_STATES.has(state.phase.state),
      );
    },
    propertyTimeout(),
  );
});
