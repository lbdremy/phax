// The command library's runner over Commander, ported to Effect 3 — a stub until phase-02 of
// the plan command-contracts ports it: every program it is given dies, so that the conformance
// suite's acceptance tests stand against it.
import { Effect } from "effect";
import type { Runner } from "../contract/index.js";

export const runner: Runner = {
  run: () => Effect.die(new Error("command runner not implemented (phase-02)")),
};
