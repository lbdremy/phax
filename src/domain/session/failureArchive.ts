/**
 * The names a previous failure is archived under when a new session starts in
 * the folder that holds it: `agent-error.log` becomes
 * `agent-error.failed-NN.log`, and the transcript the new session is about to
 * overwrite takes the same number before its extension (`output.jsonl` ->
 * `output.failed-NN.jsonl`, a Vibe export directory `output.vibe-export` ->
 * `output.failed-NN.vibe-export`). NN counts up from 01 within the folder.
 * Pure naming; the provider dispatcher does the renames.
 */

/** The log a failed session leaves in its folder. */
export const AGENT_ERROR_LOG = "agent-error.log";

const ARCHIVED_LOG = /^agent-error\.failed-(\d{2,})\.log$/;
const ARCHIVED_TRANSCRIPT = /\.failed-\d{2,}\.jsonl$/;

function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

/** The number the next archived failure in a folder takes, from the folder's entry names. */
export function nextFailureNumber(names: readonly string[]): number {
  const taken = names.flatMap((name) => {
    const match = ARCHIVED_LOG.exec(name);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  return Math.max(0, ...taken) + 1;
}

/** `agent-error.failed-NN.log`. */
export function archivedLogName(n: number): string {
  return `agent-error.failed-${twoDigits(n)}.log`;
}

/**
 * The archived name of a transcript (a file name or a path): `.failed-NN`
 * inserted before its last extension, or appended when it has none.
 */
export function archivedTranscriptName(name: string, n: number): string {
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  const tag = `.failed-${twoDigits(n)}`;
  return dot > slash + 1 ? `${name.slice(0, dot)}${tag}${name.slice(dot)}` : `${name}${tag}`;
}

/** Whether `name`, an entry of a session folder, is an archived failed session's transcript. */
export function isArchivedTranscript(name: string): boolean {
  return ARCHIVED_TRANSCRIPT.test(name);
}

/** The path a failure log's `transcript:` line names, or null for `none` or no such line. */
export function transcriptOfLog(log: string): string | null {
  const line = log.split("\n").find((l) => l.startsWith("transcript: "));
  if (line === undefined) return null;
  const path = line.slice("transcript: ".length).trim();
  return path === "" || path === "none" ? null : path;
}

/** The log with its (first) `transcript:` line naming `path`. */
export function withTranscriptLine(log: string, path: string): string {
  const lines = log.split("\n");
  const at = lines.findIndex((line) => line.startsWith("transcript: "));
  if (at === -1) return log;
  return [...lines.slice(0, at), `transcript: ${path}`, ...lines.slice(at + 1)].join("\n");
}
