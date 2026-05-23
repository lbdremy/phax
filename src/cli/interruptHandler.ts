import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { decodeRunStatus } from "../schemas/status.js";

interface RunInterruptContext {
  readonly shortName: string;
  readonly stateRoot: string;
}

let activeRunContext: RunInterruptContext | undefined;

export function setRunInterruptContext(shortName: string, stateRoot: string): void {
  activeRunContext = { shortName, stateRoot };
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
  const statusPath = join(ctx.stateRoot, "runs", ctx.shortName, "run-status.json");
  if (!existsSync(statusPath)) return;
  try {
    const raw = JSON.parse(readFileSync(statusPath, "utf8")) as unknown;
    const decoded = decodeRunStatus(raw);
    if (Either.isRight(decoded) && decoded.right.state === "running") {
      const updated = {
        ...decoded.right,
        state: "interrupted",
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(statusPath, JSON.stringify(updated, null, 2));
    }
  } catch {
    // Best-effort; do not throw inside a signal handler
  }
}

export function setupInterruptHandlers(): void {
  const handler = (): never => {
    const ctx = activeRunContext;
    if (ctx !== undefined) {
      syncWriteInterruptedState(ctx);
    }
    process.exit(130);
  };

  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}
