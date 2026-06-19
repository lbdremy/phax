import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeGlobalTelemetryJournalLayer } from "../../src/infra/telemetry/globalJournal.js";
import { SystemTelemetry } from "../../src/ports/systemTelemetry.js";
import { dailyJournalFileName } from "../../src/domain/telemetry/journal.js";
import { join } from "node:path";

const PHAX_DIR = "/fake-home/.phax";
const FIXED_NOW = new Date("2025-06-19T12:00:00.000Z");
const clock = () => FIXED_NOW.getTime();

const runWith = <A>(
  layer: Layer.Layer<SystemTelemetry, never, never>,
  eff: Effect.Effect<A, never, SystemTelemetry>,
): Promise<A> => Effect.runPromise(Effect.provide(eff, layer));

describe("makeGlobalTelemetryJournalLayer", () => {
  it("writes events to the daily journal file", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    // pre-seed the phax dir so list succeeds
    fs.addDir(PHAX_DIR);

    const journalLayer = makeGlobalTelemetryJournalLayer(PHAX_DIR, clock).pipe(
      Layer.provide(fsLayer),
    );

    await runWith(
      journalLayer,
      SystemTelemetry.pipe(Effect.flatMap((t) => t.incrementCounter("test.counter"))),
    );

    const journalFileName = dailyJournalFileName(FIXED_NOW);
    const journalPath = join(PHAX_DIR, journalFileName);
    const content = fs.getFile(journalPath);
    expect(content).toBeDefined();
    const lines = (content ?? "").split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed["ts"]).toBeDefined();
    expect(parsed["kind"]).toBe("metric.counter");
  });

  it("prunes journal files older than 7 days", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    fs.addDir(PHAX_DIR);

    // Seed old and recent journal files in PHAX_DIR
    const oldFile = join(PHAX_DIR, "telemetry-2025-06-10.jsonl"); // 9 days old → prune
    const recentFile = join(PHAX_DIR, "telemetry-2025-06-18.jsonl"); // 1 day old → keep
    fs.setFile(oldFile, '{"ts":"2025-06-10T00:00:00.000Z","kind":"metric.counter","name":"x"}\n');
    fs.setFile(
      recentFile,
      '{"ts":"2025-06-18T00:00:00.000Z","kind":"metric.counter","name":"x"}\n',
    );

    const journalLayer = makeGlobalTelemetryJournalLayer(PHAX_DIR, clock).pipe(
      Layer.provide(fsLayer),
    );

    await runWith(
      journalLayer,
      SystemTelemetry.pipe(Effect.flatMap((t) => t.incrementCounter("prune.test"))),
    );

    expect(fs.getFile(oldFile)).toBeUndefined();
    expect(fs.getFile(recentFile)).toBeDefined();
  });

  it("swallows prune errors and still emits telemetry", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    // Do NOT seed the phax dir — list will fail with ENOENT, prune swallows it

    const journalLayer = makeGlobalTelemetryJournalLayer(PHAX_DIR, clock).pipe(
      Layer.provide(fsLayer),
    );

    await expect(
      runWith(
        journalLayer,
        SystemTelemetry.pipe(Effect.flatMap((t) => t.incrementCounter("swallow.test"))),
      ),
    ).resolves.toBeUndefined();
  });

  it("keeps files within the 7-day retention window", async () => {
    const { impl: fs, layer: fsLayer } = makeFakeFileSystem();
    fs.addDir(PHAX_DIR);

    // 2025-06-12 is exactly 7 days before today (2025-06-19) → boundary → keep
    const boundaryFile = join(PHAX_DIR, "telemetry-2025-06-12.jsonl");
    fs.setFile(
      boundaryFile,
      '{"ts":"2025-06-12T00:00:00.000Z","kind":"metric.counter","name":"x"}\n',
    );

    const journalLayer = makeGlobalTelemetryJournalLayer(PHAX_DIR, clock).pipe(
      Layer.provide(fsLayer),
    );

    await runWith(
      journalLayer,
      SystemTelemetry.pipe(Effect.flatMap((t) => t.incrementCounter("keep.test"))),
    );

    expect(fs.getFile(boundaryFile)).toBeDefined();
  });
});
