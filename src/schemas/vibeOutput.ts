import { Either, Schema } from "effect";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Shape of one line in `vibe -p --output streaming`. Each line is a
 * conversation message keyed by `role` ("system" | "user" | "assistant"). The
 * streaming format does not carry a session id; that is discovered via
 * {@link findVibeSessionId} from the vibe session log directory.
 */
export const VibeStreamingMessageSchema = Schema.Struct({
  role: Schema.String,
  content: Schema.NullishOr(Schema.String),
});

export type VibeStreamingMessage = Schema.Schema.Type<typeof VibeStreamingMessageSchema>;

const decodeVibeStreamingMessage = Schema.decodeUnknownEither(VibeStreamingMessageSchema);

/**
 * Find the final assistant message text in vibe's streaming output.
 *
 * Scans from the last line backwards for `role === "assistant"` with a
 * non-empty `content` string. Returns the captured `finalText`, or `undefined`
 * if no assistant message is present.
 */
export function findVibeResultEvent(lines: readonly string[]): { finalText: string } | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const decoded = decodeVibeStreamingMessage(parsed);
    if (Either.isLeft(decoded)) continue;
    const msg = decoded.right;
    if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.length > 0) {
      return { finalText: msg.content };
    }
  }
  return undefined;
}

/**
 * The streaming format has no terminal error event — `vibe` reports failures
 * via process exit code and stderr. We keep the function for symmetry with the
 * codex adapter and as a hook for future error rows; today it inspects each
 * line for an explicit `role: "error"` shape, which the live CLI does not
 * emit, so it returns false in practice.
 */
export function hasVibeErroredResultEvent(lines: readonly string[]): boolean {
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { role?: unknown }).role === "error"
    ) {
      return true;
    }
  }
  return false;
}

const VibeSessionMetaSchema = Schema.Struct({
  session_id: Schema.String,
  start_time: Schema.optional(Schema.String),
  environment: Schema.optional(
    Schema.Struct({
      working_directory: Schema.optional(Schema.String),
    }),
  ),
});

const decodeVibeSessionMeta = Schema.decodeUnknownEither(VibeSessionMetaSchema);

export interface FindVibeSessionOptions {
  readonly cwd: string;
  readonly sinceMs: number;
  readonly vibeHome?: string;
}

/**
 * Discover the session id of the vibe run we just executed.
 *
 * `vibe -p --output streaming` does not emit a session id in its events; it
 * persists one in `<VIBE_HOME>/logs/session/session_<ts>_<short>/meta.json`.
 * We pick the most recent meta whose `environment.working_directory` matches
 * `cwd` and whose containing directory's mtime is at or after `sinceMs`.
 *
 * The path match is symlink-robust: vibe records the canonicalized working
 * directory (e.g. macOS resolves `/var/...` → `/private/var/...`), while phax
 * passes the cwd as given. Comparing both the raw and `realpath`-resolved forms
 * keeps the match correct when `state.root` lives under a symlinked path.
 */
async function resolveReal(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

async function sameDirectory(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  return (await resolveReal(a)) === (await resolveReal(b));
}

export async function findVibeSessionId(
  options: FindVibeSessionOptions,
): Promise<string | undefined> {
  const root = join(options.vibeHome ?? join(homedir(), ".vibe"), "logs", "session");
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return undefined;
  }

  let best: { sessionId: string; mtimeMs: number } | undefined;
  for (const name of entries) {
    if (!name.startsWith("session_")) continue;
    const dir = join(root, name);
    let dirStat;
    try {
      dirStat = await stat(dir);
    } catch {
      continue;
    }
    if (!dirStat.isDirectory()) continue;
    if (dirStat.mtimeMs + 1000 < options.sinceMs) continue;

    let metaText: string;
    try {
      metaText = await readFile(join(dir, "meta.json"), "utf8");
    } catch {
      continue;
    }
    let metaParsed: unknown;
    try {
      metaParsed = JSON.parse(metaText);
    } catch {
      continue;
    }
    const decoded = decodeVibeSessionMeta(metaParsed);
    if (Either.isLeft(decoded)) continue;
    const meta = decoded.right;
    const workingDir = meta.environment?.working_directory;
    if (workingDir === undefined) continue;
    if (!(await sameDirectory(workingDir, options.cwd))) continue;
    if (best === undefined || dirStat.mtimeMs > best.mtimeMs) {
      best = { sessionId: meta.session_id, mtimeMs: dirStat.mtimeMs };
    }
  }
  return best?.sessionId;
}
