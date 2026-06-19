import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { makeFakeFileSystem } from "../../../src/infra/fakes/fs.js";
import {
  makeJsonFileTelemetryOps,
  makeJsonFileSystemTelemetryLayer,
} from "../../../src/infra/telemetry/jsonFile.js";
import { FileSystem } from "../../../src/ports/fs.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";

const TRACE_PATH = "/run/semantic.jsonl";

const readLines = (content: string): unknown[] =>
  content
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("makeJsonFileTelemetryOps", () => {
  it("stamps every record with an ISO-8601 ts field", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    let tick = 0;
    const now = () => new Date("2025-01-15T10:00:00.000Z").getTime() + tick++ * 1000;
    const ops = makeJsonFileTelemetryOps(TRACE_PATH, fs, now);

    await Effect.runPromise(
      Effect.all([ops.incrementCounter("test.counter"), ops.recordDuration("test.duration", 42)], {
        concurrency: "sequential",
      }),
    );

    const lines = readLines(fs.getFile(TRACE_PATH) ?? "");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect((line as Record<string, unknown>)["ts"]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
    // ts values differ because the clock advances
    expect((lines[0] as Record<string, unknown>)["ts"]).not.toBe(
      (lines[1] as Record<string, unknown>)["ts"],
    );
  });

  it("adds durationMs to step.completed records", async () => {
    const { impl: fs } = makeFakeFileSystem();
    let tick = 0;
    // start = 1000ms, end = 3500ms → durationMs = 2500
    const now = () => 1000 + tick++ * 2500;
    const ops = makeJsonFileTelemetryOps(TRACE_PATH, fs, now);

    const exit = await Effect.runPromiseExit(
      ops.withOperation("my.step", {}, Effect.succeed("done")),
    );
    expect(Exit.isSuccess(exit)).toBe(true);

    const lines = readLines(fs.getFile(TRACE_PATH) ?? "");
    expect(lines).toHaveLength(2);

    const started = lines[0] as Record<string, unknown>;
    expect(started["kind"]).toBe("step.started");
    expect(started["durationMs"]).toBeUndefined();

    const completed = lines[1] as Record<string, unknown>;
    expect(completed["kind"]).toBe("step.completed");
    expect(completed["result"]).toBe("success");
    expect(completed["durationMs"]).toBe(2500);
  });

  it("records durationMs on failure too", async () => {
    const { impl: fs } = makeFakeFileSystem();
    let tick = 0;
    const now = () => tick++ * 100;
    const ops = makeJsonFileTelemetryOps(TRACE_PATH, fs, now);

    await Effect.runPromiseExit(ops.withOperation("fail.step", {}, Effect.fail(new Error("boom"))));

    const lines = readLines(fs.getFile(TRACE_PATH) ?? "");
    const completed = lines[1] as Record<string, unknown>;
    expect(completed["kind"]).toBe("step.completed");
    expect(completed["result"]).toBe("failure");
    expect(typeof completed["durationMs"]).toBe("number");
  });

  it("defaults now to Date.now when not provided", () => {
    const { impl: fs } = makeFakeFileSystem();
    // Should not throw — the default is wired
    expect(() => makeJsonFileTelemetryOps(TRACE_PATH, fs)).not.toThrow();
  });
});

const FIXED_NOW = () => new Date("2025-06-01T00:00:00.000Z").getTime();

describe("makeJsonFileSystemTelemetryLayer", () => {
  it("stamps ts on records emitted through the layer", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    const telemetryLayer = makeJsonFileSystemTelemetryLayer(TRACE_PATH, FIXED_NOW).pipe(
      Layer.provide(fsLayer),
    );

    await Effect.runPromise(
      Effect.provide(
        SystemTelemetry.pipe(Effect.flatMap((t) => t.incrementCounter("x"))),
        telemetryLayer,
      ),
    );

    const lines = readLines(fs.getFile(TRACE_PATH) ?? "");
    expect((lines[0] as Record<string, unknown>)["ts"]).toBe("2025-06-01T00:00:00.000Z");
  });
});
