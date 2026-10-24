import { Effect, Either, Schema } from "effect";
import { join } from "node:path";

/**
 * The two reads the vibe session finder needs, handed in by its caller so the
 * finder does no I/O itself: the names in a directory, and a file's text.
 * Each gives null when the path cannot be read.
 */
export interface VibeStoreReads {
  list(path: string): Effect.Effect<readonly string[] | null>;
  readText(path: string): Effect.Effect<string | null>;
}

// Only the id is decoded from a session's `meta.json`: the finder reads
// nothing else of it.
const VibeSessionIdSchema = Schema.Struct({ session_id: Schema.String });

const decodeVibeSessionId = Schema.decodeUnknownEither(VibeSessionIdSchema);

const META_FILE = "meta.json";

/** The session id a `meta.json` names, or null when it names none. */
function sessionIdOf(metaText: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(metaText) as unknown;
  } catch {
    return null;
  }
  const decoded = decodeVibeSessionId(parsed);
  return Either.isRight(decoded) ? decoded.right.session_id : null;
}

/**
 * Whether a directory name could hold `sessionId`. vibe appears to name a
 * session directory `session_<timestamp>_<short id>`, the short id being a
 * prefix of the session id. That convention is unverified against a current
 * vibe release, so the finder falls back to every `session_*` directory when
 * no name follows it.
 */
function nameMayHold(name: string, sessionId: string): boolean {
  const suffix = name.split("_").at(-1) ?? "";
  return suffix.length > 0 && sessionId.startsWith(suffix);
}

/**
 * The directory and `meta.json` text of the vibe session `sessionId` under
 * `<vibeRoot>/logs/session`, or null when none is found.
 */
function findVibeSession(
  reads: VibeStoreReads,
  vibeRoot: string,
  sessionId: string,
): Effect.Effect<{ readonly dir: string; readonly metaText: string } | null> {
  return Effect.gen(function* () {
    const sessionsRoot = join(vibeRoot, "logs", "session");
    const names = ((yield* reads.list(sessionsRoot)) ?? []).filter((name) =>
      name.startsWith("session_"),
    );
    const named = names.filter((name) => nameMayHold(name, sessionId));
    const candidates = named.length > 0 ? named : names;
    for (const name of candidates) {
      const dir = join(sessionsRoot, name);
      const metaText = yield* reads.readText(join(dir, META_FILE));
      if (metaText === null) continue;
      if (sessionIdOf(metaText) === sessionId) return { dir, metaText };
    }
    return null;
  });
}

/**
 * The directory of the vibe session `sessionId`: the first `session_*`
 * directory whose name may hold the id (see {@link nameMayHold}) and whose
 * `meta.json` names it, or null.
 */
export function findVibeSessionDir(
  reads: VibeStoreReads,
  vibeRoot: string,
  sessionId: string,
): Effect.Effect<string | null> {
  return findVibeSession(reads, vibeRoot, sessionId).pipe(
    Effect.map((found) => found?.dir ?? null),
  );
}

/** The `meta.json` text of the vibe session `sessionId`, where its usage lives, or null. */
export function readVibeSessionMetaText(
  reads: VibeStoreReads,
  vibeRoot: string,
  sessionId: string,
): Effect.Effect<string | null> {
  return findVibeSession(reads, vibeRoot, sessionId).pipe(
    Effect.map((found) => found?.metaText ?? null),
  );
}
