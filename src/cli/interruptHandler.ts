import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Either } from "effect";
import { activeInvocationCost, COST_LEDGER_FILE, nextLedger } from "../app/costLedger.js";
import { reviewStopPaths } from "../app/interactiveFiles.js";
import { composePhaxState } from "../app/phaxState.js";
import type { PhaseId, RunId } from "../domain/branded.js";
import { interpret } from "../domain/reducer.js";
import type { CostLedger } from "../schemas/costLedger.js";
import {
  readCostLedgerFile,
  readPhaseStatusFile,
  readReviewStopFile,
  readRunStatusFile,
  withSchemaUrl,
} from "../schemas/persisted.js";
import { encodeReviewStopFile, type LastClose } from "../schemas/reviewStop.js";
import type { PhaseStatus, RunStatus } from "../schemas/status.js";
import { runKey } from "../domain/runRef.js";

interface RunInterruptContext {
  readonly namespace: string;
  readonly shortName: string;
  readonly stateRoot: string;
}

let activeRunContext: RunInterruptContext | undefined;

export function setRunInterruptContext(
  shortName: string,
  namespace: string,
  stateRoot: string,
): void {
  activeRunContext = { namespace, shortName, stateRoot };
}

export function clearRunInterruptContext(): void {
  activeRunContext = undefined;
}

/** What the interrupt path saved: the run state written, and the stop a close was closing. */
export interface SavedInterrupt {
  readonly state: RunStatus["state"];
  /** The phase whose stop an interrupted close returned to, or null. */
  readonly stopPhaseId: string | null;
}

const PHASE_FOLDER = /^phase-\d{2}$/;

// The run's current phase when its status is awaiting_review: a running run
// with such a phase is closing that phase's stop.
function closingPhase(runPath: string, run: RunStatus): PhaseStatus | undefined {
  for (const entry of readdirSync(runPath)) {
    if (!PHASE_FOLDER.test(entry)) continue;
    const path = join(runPath, entry, "status.json");
    if (!existsSync(path)) continue;
    const decoded = readPhaseStatusFile(path, JSON.parse(readFileSync(path, "utf8")) as unknown);
    if (Either.isLeft(decoded) || decoded.right.state !== "awaiting_review") continue;
    if (run.currentPhaseIndex !== undefined && decoded.right.phaseIndex !== run.currentPhaseIndex) {
      continue;
    }
    return decoded.right;
  }
  return undefined;
}

// RestoreReviewStop, synchronously: the parked document (or the live one when
// the close never parked it) back at the run folder with `lastClose` set and
// every other field, `closeBase` included, kept. Returns false, writing
// nothing, when there is no document it can read.
function syncRestoreReviewStop(
  runPath: string,
  phaseFolder: string,
  lastClose: LastClose,
): boolean {
  const { live, parked } = reviewStopPaths(runPath, phaseFolder);
  const source = existsSync(parked) ? parked : live;
  if (!existsSync(source)) return false;
  const decoded = readReviewStopFile(source, JSON.parse(readFileSync(source, "utf8")) as unknown);
  if (Either.isLeft(decoded)) return false;
  const restored = withSchemaUrl("review-stop", { ...decoded.right, lastClose });
  writeFileSync(live, JSON.stringify(encodeReviewStopFile(restored), null, 2));
  if (source === parked) rmSync(parked);
  return true;
}

// Sanctioned bypass of the dispatcher single-writer invariant: SIGINT/SIGTERM
// handlers run in a synchronous context where Effect / await are unavailable,
// so the interrupt path writes run-status.json directly with the synchronous
// fs API. The architectural guard test allows this file to import the status
// schemas for the same reason. A run that is not running is left as it is.
// A running run whose current phase awaits review is closing its stop: the
// reducer's verdict for RunInterruptRequested on that state is written,
// awaiting_review with review-stop.json restored, lastClose `interrupted`.
// A run awaits review only with its review-stop.json, so when no review stop
// can be restored the run is saved as any other interrupted run.
export function syncSaveInterruptedRun(ctx: RunInterruptContext): SavedInterrupt | null {
  const runPath = join(ctx.stateRoot, "runs", runKey(ctx.namespace, ctx.shortName));
  const statusPath = join(runPath, "run-status.json");
  if (!existsSync(statusPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(statusPath, "utf8")) as unknown;
    const decoded = readRunStatusFile(statusPath, raw);
    if (Either.isLeft(decoded) || decoded.right.state !== "running") return null;
    const run = decoded.right;
    const write = (state: RunStatus["state"]): void => {
      const updated: RunStatus = { ...run, state, updatedAt: new Date().toISOString() };
      writeFileSync(statusPath, JSON.stringify(withSchemaUrl("run-status", updated), null, 2));
    };

    const stopped = closingPhase(runPath, run);
    if (stopped === undefined) {
      write("interrupted");
      return { state: "interrupted", stopPhaseId: null };
    }
    const verdict = interpret(composePhaxState(run.state, run.lastError, stopped), {
      type: "RunInterruptRequested",
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      run: ctx.shortName as unknown as RunId,
      phase: stopped.phaseId as PhaseId,
    });
    if (verdict.kind !== "Handled") return null;
    for (const effect of verdict.effects) {
      if (
        effect.type === "RestoreReviewStop" &&
        !syncRestoreReviewStop(runPath, join(runPath, stopped.phaseId), effect.lastClose)
      ) {
        write("interrupted");
        return { state: "interrupted", stopPhaseId: null };
      }
    }
    write(verdict.nextState.run);
    return { state: verdict.nextState.run, stopPhaseId: stopped.phaseId };
  } catch {
    // Best-effort; do not throw inside a signal handler
    return null;
  }
}

// The same bypass for the cost ledger: the process exits before the running
// Claude invocation's `onExit` can record it, so its partial entry is written
// here, from the stream it has written so far. A ledger phax cannot read is
// left as it is.
export function syncRecordInterruptedInvocation(): void {
  const active = activeInvocationCost();
  if (active === undefined) return;
  const { opts, startedAt } = active;
  try {
    if (!existsSync(opts.streamPath)) return;
    const ledgerPath = join(opts.runPath, COST_LEDGER_FILE);
    let ledger: CostLedger = { entries: [] };
    if (existsSync(ledgerPath)) {
      const read = readCostLedgerFile(
        ledgerPath,
        JSON.parse(readFileSync(ledgerPath, "utf8")) as unknown,
      );
      if (Either.isLeft(read)) return;
      ledger = read.right;
    }
    const now = Date.now();
    const next = nextLedger(
      opts,
      readFileSync(opts.streamPath, "utf8"),
      ledger,
      now - startedAt,
      new Date(now).toISOString(),
    );
    if (next !== null) writeFileSync(ledgerPath, next);
  } catch {
    // Best-effort; do not throw inside a signal handler
  }
}

export function setupInterruptHandlers(): void {
  const handler = (): never => {
    syncRecordInterruptedInvocation();
    const ctx = activeRunContext;
    if (ctx !== undefined) {
      const saved = syncSaveInterruptedRun(ctx);
      const name = runKey(ctx.namespace, ctx.shortName);
      process.stderr.write(
        saved?.stopPhaseId !== null && saved?.stopPhaseId !== undefined
          ? `\nRun "${name}": the close of ${saved.stopPhaseId} was interrupted — the stop is still waiting. Close it with: phax resume ${ctx.shortName} --yes\n`
          : `\nRun "${name}" interrupted — state saved. Resume with: phax resume ${ctx.shortName} --yes\n`,
      );
    }
    process.exit(130);
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
