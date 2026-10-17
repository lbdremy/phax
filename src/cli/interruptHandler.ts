import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { activeInvocationCost, COST_LEDGER_FILE, nextLedger } from "../app/costLedger.js";
import type { CostLedger } from "../schemas/costLedger.js";
import { readCostLedgerFile, readRunStatusFile, withSchemaUrl } from "../schemas/persisted.js";
import type { RunStatus } from "../schemas/status.js";
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

// Sanctioned bypass of the dispatcher single-writer invariant: SIGINT/SIGTERM
// handlers run in a synchronous context where Effect / await are unavailable,
// so the interrupt path writes run-status.json directly with the synchronous
// fs API. The architectural guard test allows this file to import the status
// schemas for the same reason.
function syncWriteInterruptedState(ctx: RunInterruptContext): void {
  const statusPath = join(
    ctx.stateRoot,
    "runs",
    runKey(ctx.namespace, ctx.shortName),
    "run-status.json",
  );
  if (!existsSync(statusPath)) return;
  try {
    const raw = JSON.parse(readFileSync(statusPath, "utf8")) as unknown;
    const decoded = readRunStatusFile(statusPath, raw);
    if (Either.isRight(decoded) && decoded.right.state === "running") {
      const updated: RunStatus = {
        ...decoded.right,
        state: "interrupted",
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(statusPath, JSON.stringify(withSchemaUrl("run-status", updated), null, 2));
    }
  } catch {
    // Best-effort; do not throw inside a signal handler
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
      syncWriteInterruptedState(ctx);
      const name = runKey(ctx.namespace, ctx.shortName);
      process.stderr.write(
        `\nRun "${name}" interrupted — state saved. Resume with: phax resume ${ctx.shortName} --yes\n`,
      );
    }
    process.exit(130);
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
