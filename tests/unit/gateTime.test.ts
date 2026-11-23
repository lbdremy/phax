import { Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { measuredTime, timed } from "../../src/app/gateTime.js";

const START = Date.UTC(2026, 10, 23, 10, 0, 0, 5);

describe("measuredTime", () => {
  it("writes the start as an ISO-8601 UTC instant with milliseconds", () => {
    expect(measuredTime(START, START + 1500).startedAt).toBe("2026-11-23T10:00:00.005Z");
    expect(measuredTime(0, 0).startedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it.each([
    ["an equal end reading", START, 0],
    ["a later end reading", START + 191_300, 191_300],
    ["a fractional end reading, rounded to a whole millisecond", START + 2.6, 3],
    ["an earlier end reading (the clock stepped backwards)", START - 40, 0],
  ])("gives %s a whole, never negative duration", (_label, end, durationMs) => {
    expect(measuredTime(START, end)).toEqual({
      kind: "measured",
      startedAt: "2026-11-23T10:00:00.005Z",
      durationMs,
    });
  });
});

describe("timed", () => {
  it("times a success and a failure alike between two Clock readings", async () => {
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(START);
      const passed = yield* timed(TestClock.adjust("2 seconds").pipe(Effect.as("ok")));
      const failed = yield* timed(
        TestClock.adjust("250 millis").pipe(Effect.andThen(Effect.fail("broken"))),
      );
      return { passed, failed };
    });
    const { passed, failed } = await Effect.runPromise(
      program.pipe(Effect.provide(TestClock.layer())),
    );
    expect(passed).toEqual([
      Result.succeed("ok"),
      { kind: "measured", startedAt: "2026-11-23T10:00:00.005Z", durationMs: 2000 },
    ]);
    expect(failed).toEqual([
      Result.fail("broken"),
      { kind: "measured", startedAt: "2026-11-23T10:00:02.005Z", durationMs: 250 },
    ]);
  });
});
