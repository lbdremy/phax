import { Effect } from "effect";
import type { SystemTelemetryOps, TelemetryAttributes } from "../../src/ports/systemTelemetry.js";

declare const ops: SystemTelemetryOps;
declare const attrs: TelemetryAttributes;

// withOperation must preserve the success type
const successChannel: Effect.Effect<number, string, never> = ops.withOperation(
  "op",
  attrs,
  Effect.succeed(42) as Effect.Effect<number, string, never>,
);

// withOperation must preserve the error type (no widening)
const errorChannel: Effect.Effect<number, string, never> = ops.withOperation(
  "op",
  attrs,
  Effect.fail("err") as Effect.Effect<number, string, never>,
);

// The error channel must NOT be widened to `unknown`
// @ts-expect-error: Effect<number, unknown, never> is not assignable to Effect<number, string, never>
const widened: Effect.Effect<number, string, never> = ops.withOperation(
  "op",
  attrs,
  Effect.fail(new Error("oops")) as Effect.Effect<number, unknown, never>,
);

void successChannel;
void errorChannel;
void widened;
