import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeStateTransitionTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import { makeInMemoryTelemetryLayer } from "../../../src/infra/telemetry/inMemory.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";

const runId = Either.getOrThrow(decodeRunId("snapshot-run-001"));

/**
 * Scripted workflow: state transition → adapter call started →
 * adapter call succeeded → step completed.
 * Asserts the stable SemanticTraceSnapshot projection.
 */
describe("InMemoryTelemetry snapshot projection", () => {
  it("pins the snapshot for a scripted workflow", async () => {
    const { impl, layer } = makeInMemoryTelemetryLayer();

    const workflow = SystemTelemetry.pipe(
      Effect.flatMap((t) =>
        Effect.all(
          [
            t.recordTransition(
              makeStateTransitionTelemetryEvent({
                runId,
                event: "RUN_STARTED",
                stateBefore: "idle",
                stateAfter: "running",
                dispatcher: "dispatcher.ts",
              }),
            ),
            t.recordEvent(
              makeAdapterCallStartedTelemetryEvent({
                runId,
                adapter: "git",
                operation: "worktree.create",
              }),
            ),
            t.recordEvent(
              makeAdapterCallSucceededTelemetryEvent({
                runId,
                adapter: "git",
                operation: "worktree.create",
              }),
            ),
            t.recordEvent(
              makeStepCompletedTelemetryEvent({
                runId,
                step: "setup",
                result: "success",
              }),
            ),
          ],
          { concurrency: "sequential" },
        ),
      ),
    );

    await Effect.runPromise(Effect.provide(workflow, layer));

    const snapshot = impl.getSemanticTraceSnapshot();
    expect(snapshot).toMatchSnapshot();
  });

  it("produces identical output on a second run", async () => {
    const run = async () => {
      const { impl, layer } = makeInMemoryTelemetryLayer();
      await Effect.runPromise(
        Effect.provide(
          SystemTelemetry.pipe(
            Effect.flatMap((t) =>
              Effect.all(
                [
                  t.recordTransition(
                    makeStateTransitionTelemetryEvent({
                      runId,
                      event: "RUN_STARTED",
                      stateBefore: "idle",
                      stateAfter: "running",
                      dispatcher: "dispatcher.ts",
                    }),
                  ),
                  t.recordEvent(
                    makeStepCompletedTelemetryEvent({
                      runId,
                      step: "setup",
                      result: "success",
                    }),
                  ),
                ],
                { concurrency: "sequential" },
              ),
            ),
          ),
          layer,
        ),
      );
      return impl.getSemanticTraceSnapshot();
    };

    const [first, second] = await Promise.all([run(), run()]);
    expect(first).toEqual(second);
  });
});
