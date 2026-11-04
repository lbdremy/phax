// `phax cost backfill` as the runner reads it: a cost ledger for every registered run that has
// none, derived from its kept streams. Its answer is today's result (the runs it wrote a ledger
// for, the runs it skipped, the totals) and the cost-ledger.json files it wrote as written-file
// records, each with its absolute path (the ledgers live under ~/.phax, outside any repository).
import { join } from "node:path";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { backfillCostLedgers, runFolderOf } from "../../app/costBackfill.js";
import { COST_LEDGER_FILE } from "../../app/costLedger.js";
import { readRegistry } from "../../app/registry.js";
import { runKey } from "../../domain/runRef.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { FileSystem } from "../../ports/fs.js";
import {
  defineCommand,
  defineGroup,
  reject,
  Written,
  written,
} from "../commandLibrary/contract/index.js";
import { makeRepoRootedFileSystemLayer } from "../commands/runLayers.js";
import { configured, exposeMessage, MessageFields } from "./shared.js";

function grouped(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const CostBackfillOutput = Schema.Struct({
  /** The runs a ledger was written for. */
  ledgers: Schema.Array(
    Schema.Struct({
      qualifiedName: Schema.String,
      invocations: Schema.Number,
      costUsd: Schema.Number,
    }),
  ),
  /** The runs skipped because their lock is active. */
  locked: Schema.Array(Schema.String),
  /** The runs skipped because their folder is missing. */
  missing: Schema.Array(Schema.String),
  /** The invocations of every ledger written. */
  invocations: Schema.Number,
  /** The API-list cost of every ledger written, USD. */
  costUsd: Schema.Number,
  written: Schema.Array(Written),
});

export const costBackfillCommand = defineCommand({
  name: "backfill",
  summary: "Write a cost ledger for every kept run that has none, from its kept streams",
  help: "Writes cost-ledger.json for every run in the registry, across namespaces, that has none, derived from the Claude streams its run folder kept: each phase's output.jsonl, fix-attempt-NN.jsonl and handoff-generation.jsonl (reset phase folders first), then compliance-review.session.jsonl, compliance-review-retry.session.jsonl, code-review.session.jsonl and code-review-retry.session.jsonl. It reads the active run folder (~/.phax/runs/<namespace>.<short-name>/) or the archived one (~/.phax/archive/<namespace>.<short-name>/runs/). Each entry is the invocation's own cost, corrected when Claude Code reports a resumed session cumulatively; its end time is the stream's modification time, and an interrupted invocation carries no duration. A run with no Claude stream gets an empty ledger.\n\nNever touches a run that already has a ledger, never rewrites a ledger and never reads a pruned run or phax/records/v1. A locked run is skipped and named, and so is a run whose folder is missing. A second pass reports nothing to backfill.\n\nPrints `wrote <N> cost ledgers (<M> invocations, $<X> API-list)` or `nothing to backfill`. Exits 0 on success, 1 on error.\n\nSide effects: creates cost-ledger.json in run folders under ~/.phax/runs/ and ~/.phax/archive/.",
  examples: ["phax cost backfill"],
  input: {},
  output: reject(CostBackfillOutput),
  run: () =>
    Effect.gen(function* () {
      const config = yield* configured();
      const { stateRoot } = config;
      const layer = Layer.merge(
        makeRepoRootedFileSystemLayer(config),
        makeNodeLockLayer(stateRoot),
      );
      return yield* Effect.gen(function* () {
        const result = yield* backfillCostLedgers({ stateRoot });
        const registry = yield* readRegistry(stateRoot);
        const fs = yield* FileSystem;
        // Each ledger written, as the disk holds it now.
        const files = yield* Effect.forEach(result.written, (ledger) =>
          Effect.gen(function* () {
            const entry = registry.runs.find(
              (each) => runKey(each.namespace, each.shortName) === ledger.qualifiedName,
            );
            const path = join(runFolderOf(stateRoot, entry!), COST_LEDGER_FILE);
            return yield* written(path, yield* fs.readBytes(path));
          }),
        );
        return {
          ledgers: result.written,
          locked: result.locked,
          missing: result.missing,
          invocations: result.written.reduce((sum, run) => sum + run.invocations, 0),
          costUsd: result.written.reduce((sum, run) => sum + run.costUsd, 0),
          written: files,
        };
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.mapError(exposeMessage)),
  exits: { ConfigValidationError: 1, FsError: 1, RegistryCorruptionError: 1 },
  errors: {
    ConfigValidationError: MessageFields,
    FsError: MessageFields,
    RegistryCorruptionError: MessageFields,
  },
  texts: {
    ConfigValidationError: (error) => `Config error: ${error.message}`,
    FsError: (error) => `phax cost backfill failed: ${error.message}`,
    RegistryCorruptionError: (error) => `phax cost backfill failed: ${error.message}`,
  },
  render: (value) => {
    const lines: string[] = [];
    if (value.ledgers.length === 0) {
      lines.push("nothing to backfill");
    } else {
      lines.push(
        `wrote ${grouped(value.ledgers.length, 0)} cost ledgers (${grouped(value.invocations, 0)} invocations, $${grouped(value.costUsd, 2)} API-list)`,
      );
    }
    if (value.locked.length > 0) {
      lines.push(`skipped ${value.locked.length} locked run(s): ${value.locked.join(", ")}`);
    }
    if (value.missing.length > 0) {
      lines.push(
        `skipped ${value.missing.length} run(s) with no run folder: ${value.missing.join(", ")}`,
      );
    }
    return lines.join("\n");
  },
});

export const costGroup = defineGroup({
  name: "cost",
  summary: "Manage the runs' cost ledgers",
  help: "Parent command for the runs' cost ledgers. Every run keeps cost-ledger.json in its run folder: one entry per Claude invocation (phase turn, fix attempt, handoff generation, compliance review, code review) with its own API-list cost, tokens per model, agent duration, end time and subscription-window samples. phax archive moves it with the run, and phax prune keeps a copy under ~/.phax/cost-ledgers/.",
  examples: ["phax cost backfill"],
  commands: [costBackfillCommand],
});
