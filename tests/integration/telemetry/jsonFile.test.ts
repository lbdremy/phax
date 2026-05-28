import { Effect, Either, Layer } from "effect";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeRunId } from "../../../src/domain/branded.js";
import {
  makeAdapterCallStartedTelemetryEvent,
  makeAdapterCallSucceededTelemetryEvent,
  makeStepCompletedTelemetryEvent,
  makeStateTransitionTelemetryEvent,
} from "../../../src/domain/telemetry/events.js";
import { makeJsonFileSystemTelemetryLayer } from "../../../src/infra/telemetry/jsonFile.js";
import { NodeFileSystemLayer } from "../../../src/infra/fs.js";
import { SystemTelemetry } from "../../../src/ports/systemTelemetry.js";
import { decodeSemanticTelemetryEvent } from "../../../src/schemas/telemetryEvents.js";

const runId = Either.getOrThrow(decodeRunId("json-file-run-001"));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phax-jsonfile-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("JsonFileTelemetry", () => {
  it("round-trips semantic events through the JSONL file", async () => {
    const filePath = join(tmpDir, "semantic.jsonl");

    const events = [
      makeStateTransitionTelemetryEvent({
        runId,
        event: "RUN_STARTED",
        stateBefore: "idle",
        stateAfter: "running",
        dispatcher: "dispatcher.ts",
      }),
      makeAdapterCallStartedTelemetryEvent({
        runId,
        adapter: "git",
        operation: "worktree.create",
      }),
      makeAdapterCallSucceededTelemetryEvent({
        runId,
        adapter: "git",
        operation: "worktree.create",
      }),
      makeStepCompletedTelemetryEvent({
        runId,
        step: "setup",
        result: "success",
      }),
    ];

    const layer = makeJsonFileSystemTelemetryLayer(filePath).pipe(
      Layer.provide(NodeFileSystemLayer),
    );

    await Effect.runPromise(
      Effect.flatMap(SystemTelemetry, (t) =>
        Effect.all(
          events.map((e) => t.recordEvent(e)),
          { concurrency: "sequential" },
        ),
      ).pipe(Effect.provide(layer)),
    );

    const raw = await readFile(filePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(events.length);

    for (const line of lines) {
      const parsed = JSON.parse(line) as unknown;
      const decoded = decodeSemanticTelemetryEvent(parsed);
      expect(Either.isRight(decoded)).toBe(true);
    }

    // verify order matches insertion order
    const decoded = lines.map((l) => JSON.parse(l) as { type: string });
    expect(decoded.map((d) => d.type)).toEqual(events.map((e) => e.type));
  });

  it("tolerates IO failures without propagating errors", async () => {
    // Point at a path inside a read-only parent that cannot be created
    const readOnlyDir = join(tmpDir, "readonly");
    await mkdir(readOnlyDir, { mode: 0o444 });
    const filePath = join(readOnlyDir, "nested", "semantic.jsonl");

    const layer = makeJsonFileSystemTelemetryLayer(filePath).pipe(
      Layer.provide(NodeFileSystemLayer),
    );

    const event = makeStepCompletedTelemetryEvent({ runId, step: "noop", result: "success" });

    // Must resolve void — never throw or fail the Effect
    await expect(
      Effect.runPromise(
        Effect.flatMap(SystemTelemetry, (t) => t.recordEvent(event)).pipe(Effect.provide(layer)),
      ),
    ).resolves.toBeUndefined();
  });

  it("preserves order across rapid successive writes", async () => {
    const filePath = join(tmpDir, "order.jsonl");

    const layer = makeJsonFileSystemTelemetryLayer(filePath).pipe(
      Layer.provide(NodeFileSystemLayer),
    );

    const eventCount = 20;
    const steps = Array.from({ length: eventCount }, (_, i) =>
      makeStepCompletedTelemetryEvent({ runId, step: `step-${i}`, result: "success" }),
    );

    await Effect.runPromise(
      Effect.flatMap(SystemTelemetry, (t) =>
        Effect.all(
          steps.map((e) => t.recordEvent(e)),
          { concurrency: "sequential" },
        ),
      ).pipe(Effect.provide(layer)),
    );

    const raw = await readFile(filePath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(eventCount);

    const decoded = lines.map((l) => JSON.parse(l) as { step: string });
    for (let i = 0; i < eventCount; i++) {
      expect(decoded[i]?.step).toBe(`step-${i}`);
    }
  });
});
