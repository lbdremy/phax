import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import {
  makeStepStartedTelemetryEvent,
  makeStepCompletedTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import { makeSystemTelemetryLayer } from "../../../src/infra/telemetry/layer.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";
import type { OutputPort } from "../../../src/ports/output.js";

const runId = Either.getOrThrow(decodeRunId("factory-test-001"));

const makeTestOutput = (): { out: OutputPort; lines: string[]; errors: string[] } => {
  const lines: string[] = [];
  const errors: string[] = [];
  const out: OutputPort = {
    log: (msg) => {
      lines.push(msg);
    },
    warn: (msg) => {
      lines.push(msg);
    },
    error: (msg) => {
      errors.push(msg);
    },
  };
  return { out, lines, errors };
};

const runWith = <A>(
  layer: Layer.Layer<SystemTelemetry, never, never>,
  eff: Effect.Effect<A, never, SystemTelemetry>,
): Promise<A> => Effect.runPromise(Effect.provide(eff, layer));

const buildWithFakeFs = (
  input: Parameters<typeof makeSystemTelemetryLayer>[0],
): { layer: Layer.Layer<SystemTelemetry>; fs: ReturnType<typeof makeFakeFileSystem>["impl"] } => {
  const { impl: fsImpl, layer: fsLayer } = makeFakeFileSystem();
  const telemetryLayer = makeSystemTelemetryLayer(input).pipe(Layer.provide(fsLayer));
  return { layer: telemetryLayer, fs: fsImpl };
};

describe("makeSystemTelemetryLayer", () => {
  describe("all flags off (noop-equivalent)", () => {
    it("resolves without error", async () => {
      const { out } = makeTestOutput();
      const { layer } = buildWithFakeFs({
        output: out,
        verbose: false,
        runId,
      });

      const event = makeStepStartedTelemetryEvent({ runId, step: "test-step" });
      await expect(
        runWith(layer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event)))),
      ).resolves.toBeUndefined();
    });

    it("does not print to output when verbose is false", async () => {
      const { out, lines } = makeTestOutput();
      const { layer } = buildWithFakeFs({
        output: out,
        verbose: false,
        runId,
      });

      const event = makeStepStartedTelemetryEvent({ runId, step: "silent" });
      await runWith(layer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event))));
      expect(lines).toHaveLength(0);
    });
  });

  describe("verbose: true", () => {
    it("prints semantic events to OutputPort", async () => {
      const { out, lines } = makeTestOutput();
      const { layer } = buildWithFakeFs({
        output: out,
        verbose: true,
        runId,
      });

      const e1 = makeStepStartedTelemetryEvent({ runId, step: "config.discover" });
      const e2 = makeStepCompletedTelemetryEvent({
        runId,
        step: "config.discover",
        result: "success",
      });

      await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) =>
            Effect.all([t.recordEvent(e1), t.recordEvent(e2)], { concurrency: "sequential" }),
          ),
        ),
      );

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("step.started");
      expect(lines[0]).toContain("config.discover");
      expect(lines[1]).toContain("step.completed");
    });

    it("does not write to disk when tracePath is undefined", async () => {
      const { out } = makeTestOutput();
      const { layer, fs } = buildWithFakeFs({
        output: out,
        verbose: true,
        runId,
      });

      const event = makeStepStartedTelemetryEvent({ runId, step: "memory-only" });
      await runWith(layer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event))));
      expect(fs.files.size).toBe(0);
    });
  });

  describe("tracePath set", () => {
    it("writes semantic events to the specified file", async () => {
      const { out } = makeTestOutput();
      const tracePath = "/tmp/phax-test/semantic.jsonl";
      const { layer, fs } = buildWithFakeFs({
        output: out,
        verbose: false,
        tracePath,
        runId,
      });

      const event = makeStepStartedTelemetryEvent({ runId, step: "file-write-test" });
      await runWith(layer, SystemTelemetry.pipe(Effect.flatMap((t) => t.recordEvent(event))));

      const content = fs.files.get(tracePath);
      expect(content).toBeDefined();
      const parsed: unknown = JSON.parse((content ?? "").trim());
      expect(parsed).toMatchObject({ type: "step.started", step: "file-write-test" });
    });

    it("written events round-trip through JSON parse", async () => {
      const { out } = makeTestOutput();
      const tracePath = "/tmp/phax-test/roundtrip.jsonl";
      const { layer, fs } = buildWithFakeFs({
        output: out,
        verbose: false,
        tracePath,
        runId,
      });

      const e1 = makeStepStartedTelemetryEvent({ runId, step: "step-a" });
      const e2 = makeStepCompletedTelemetryEvent({ runId, step: "step-a", result: "success" });

      await runWith(
        layer,
        SystemTelemetry.pipe(
          Effect.flatMap((t) =>
            Effect.all([t.recordEvent(e1), t.recordEvent(e2)], { concurrency: "sequential" }),
          ),
        ),
      );

      const lines = (fs.files.get(tracePath) ?? "").trim().split("\n");
      expect(lines).toHaveLength(2);
      const parsed = lines.map((l) => JSON.parse(l) as unknown);
      expect(parsed[0]).toMatchObject({ type: "step.started", step: "step-a" });
      expect(parsed[1]).toMatchObject({
        type: "step.completed",
        step: "step-a",
        result: "success",
      });
    });
  });
});
