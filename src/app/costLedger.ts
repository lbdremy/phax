// Appends one entry to the run's cost ledger when a Claude invocation ends:
// on success, failure, rate limit or interruption. The stream is read through
// the FileSystem port and decoded at the schema boundary; the domain computes
// the entry. A ledger failure never changes the invocation's outcome: it is
// reported to telemetry and as a warning on stderr, and a ledger phax cannot
// read is never overwritten.
import { Cause, Clock, Effect, Either } from "effect";
import { join } from "node:path";
import type { RunId } from "../domain/branded.js";
import { appendEntry, ledgerEntryFor, type InvocationRole } from "../domain/cost/ledger.js";
import { FileSystem } from "../ports/fs.js";
import { SystemTelemetry } from "../ports/systemTelemetry.js";
import { parseClaudeStream } from "../schemas/claudeStream.js";
import type { CostLedger } from "../schemas/costLedger.js";
import { readCostLedgerFile, withSchemaUrl } from "../schemas/persisted.js";
import type { ProviderId } from "../schemas/providerId.js";
import { reportCostLedgerFailure } from "./telemetry/reportBuilders.js";

export const COST_LEDGER_FILE = "cost-ledger.json";

export type InvocationCostOptions = InvocationRole & {
  /** The run, as the call site's telemetry names it. */
  readonly runId: RunId;
  readonly runPath: string;
  readonly provider: ProviderId;
  /** The invocation's stream-json output. */
  readonly streamPath: string;
};

class LedgerFailure {
  constructor(readonly message: string) {}
}

function failureMessage(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  if (error instanceof LedgerFailure || error instanceof Error) return error.message;
  return String(error);
}

function readLedger(path: string): Effect.Effect<CostLedger, unknown, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(path))) return { entries: [] };
    const text = yield* fs.readText(path);
    const parsed = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new LedgerFailure(`${path}: not JSON — left as it is`),
    });
    const read = readCostLedgerFile(path, parsed);
    if (Either.isLeft(read)) {
      return yield* Effect.fail(new LedgerFailure(`${read.left.message} — left as it is`));
    }
    return read.right;
  });
}

function recordEntry(
  opts: InvocationCostOptions,
  elapsedMs: number,
): Effect.Effect<void, unknown, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(opts.streamPath))) return;
    const facts = parseClaudeStream((yield* fs.readText(opts.streamPath)).split("\n"));
    const ledgerPath = join(opts.runPath, COST_LEDGER_FILE);
    const ledger = yield* readLedger(ledgerPath);
    const endedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
    const role: InvocationRole =
      opts.role === "compliance"
        ? { role: opts.role, phase: null }
        : { role: opts.role, phase: opts.phase };
    const entry = ledgerEntryFor({
      ...role,
      facts,
      earlier: ledger.entries,
      partialAgentMs: elapsedMs,
      endedAt,
    });
    if (entry === null) return;
    yield* fs.writeAtomic(
      ledgerPath,
      JSON.stringify(withSchemaUrl("cost-ledger", appendEntry(ledger, entry)), null, 2),
    );
  });
}

function describeInvocation(opts: InvocationCostOptions): string {
  return opts.phase === null
    ? `run "${opts.runId}" — ${opts.role}`
    : `run "${opts.runId}", phase "${opts.phase}" — ${opts.role}`;
}

/**
 * `invocation`, with its cost ledger entry appended to
 * `<runPath>/cost-ledger.json` when it ends, whatever its exit. Nothing is
 * recorded for a provider other than Claude Code, for an absent stream, or for
 * a stream that never started. The wrapped exit is never changed.
 */
export function withInvocationCost<A, E, R>(
  invocation: Effect.Effect<A, E, R>,
  opts: InvocationCostOptions,
): Effect.Effect<A, E, R | FileSystem | SystemTelemetry> {
  if (opts.provider !== "claude-code") return invocation;
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    return yield* invocation.pipe(
      Effect.onExit(() =>
        Effect.gen(function* () {
          const elapsedMs = (yield* Clock.currentTimeMillis) - startedAt;
          yield* recordEntry(opts, elapsedMs);
        }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.gen(function* () {
              const telemetry = yield* SystemTelemetry;
              const message = failureMessage(cause);
              yield* telemetry.recordError(
                reportCostLedgerFailure(Cause.squash(cause), {
                  runId: opts.runId,
                  ...(opts.phase !== null ? { operationId: opts.phase } : {}),
                  adapter: opts.provider,
                  operation: `cost-ledger.${opts.role}`,
                }),
              );
              yield* Effect.sync(() => {
                process.stderr.write(
                  `[phax] Warning: ${describeInvocation(opts)} — failed to record its cost ledger entry (${message}).\n`,
                );
              });
            }),
          ),
        ),
      ),
    );
  });
}
