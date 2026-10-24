import { Effect } from "effect";
import { readdir, readFile } from "node:fs/promises";
import { isSafeSessionId } from "../../domain/interactive/transcripts.js";
import type { TranscriptRead } from "../../ports/backend.js";

// What the three adapters share to read a transcript from a provider's own
// session store. They only find and read: nothing here writes, and a read
// never fails — every outcome is a `TranscriptRead`.

const UNSAFE_SESSION_ID: TranscriptRead = {
  status: "missing",
  reason: "unreadable",
  detail: "unsafe session id",
};

const NO_PROVIDER_STORE: TranscriptRead = {
  status: "missing",
  reason: "not-found",
  detail: "no provider store configured",
};

export function notFound(detail: string): TranscriptRead {
  return { status: "missing", reason: "not-found", detail };
}

export function unreadable(err: unknown): TranscriptRead {
  return {
    status: "missing",
    reason: "unreadable",
    detail: err instanceof Error ? err.message : String(err),
  };
}

/** Whether an error means the path is not there (as opposed to not readable). */
export function isAbsence(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** The bytes of the file at `path`: `not-found` when it is absent, `unreadable` on any other error. */
export async function readStoreFile(path: string): Promise<TranscriptRead> {
  try {
    return { status: "found", bytes: new Uint8Array(await readFile(path)) };
  } catch (err) {
    return isAbsence(err) ? notFound(`no transcript at ${path}`) : unreadable(err);
  }
}

/** The names in the directory at `path`; `absent` when it is not there. Other errors throw. */
export async function listStoreNames(path: string): Promise<readonly string[] | "absent"> {
  try {
    return await readdir(path);
  } catch (err) {
    if (isAbsence(err)) return "absent";
    throw err;
  }
}

/** Claude Code's project folder name for a working directory: every character outside `[A-Za-z0-9]` becomes `-`. */
export function claudeProjectSlug(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Run a store lookup for `sessionId`: an unsafe id or no root is `missing`
 * before anything is read, and an error the lookup lets through becomes
 * `unreadable`.
 */
export function captureFromStore(
  root: string | null,
  sessionId: string,
  lookup: (root: string) => Promise<TranscriptRead>,
): Effect.Effect<TranscriptRead, never> {
  if (!isSafeSessionId(sessionId)) return Effect.succeed(UNSAFE_SESSION_ID);
  if (root === null) return Effect.succeed(NO_PROVIDER_STORE);
  return Effect.promise(() => lookup(root).catch(unreadable));
}
