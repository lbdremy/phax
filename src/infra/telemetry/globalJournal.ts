import { Effect, Layer } from "effect";
import { join } from "node:path";
import { dailyJournalFileName, journalFilesToPrune } from "../../domain/telemetry/journal.js";
import { makeJsonFileTelemetryOps } from "./jsonFile.js";
import { InMemoryTelemetry } from "./inMemory.js";
import { makeCompositeOps } from "./composite.js";
import { FileSystem } from "../../ports/fs.js";
import { SystemTelemetry } from "../../ports/systemTelemetry.js";

const RETENTION_DAYS = 7;

const pruneOldJournals = (dir: string, today: Date): Effect.Effect<void, never, FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const names = yield* Effect.catchAll(fs.list(dir), () =>
      Effect.succeed([] as readonly string[]),
    );
    const toRemove = journalFilesToPrune(names, today, RETENTION_DAYS);
    for (const name of toRemove) {
      yield* Effect.catchAll(fs.remove(join(dir, name)), () => Effect.void);
    }
  });

/**
 * Build a SystemTelemetry layer backed by a daily global journal file.
 * On construction, creates the phaxDir and prunes journals older than 7 days.
 * Errors from pruning are swallowed — telemetry must never break a command.
 */
export const makeGlobalTelemetryJournalLayer = (
  phaxDir: string,
  now: () => number = () => Date.now(),
): Layer.Layer<SystemTelemetry, never, FileSystem> =>
  Layer.effect(
    SystemTelemetry,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const today = new Date(now());
      const journalPath = join(phaxDir, dailyJournalFileName(today));

      yield* Effect.catchAll(fs.mkdirp(phaxDir), () => Effect.void);
      yield* pruneOldJournals(phaxDir, today);

      const jsonFileOps = makeJsonFileTelemetryOps(journalPath, fs, now);
      const inMemoryOps = new InMemoryTelemetry();
      return makeCompositeOps([inMemoryOps, jsonFileOps]);
    }),
  );
