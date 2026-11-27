// The pure rules of phax's home: what it is, the files it holds, the refusal of an invalid
// PHAX_HOME, and the home pinned to a run (its record, the shape of a run's phase worktree and
// the refusals). Resolving it (reading PHAX_HOME and the user's home) is src/app/phaxHome.ts's;
// locating a run's worktree and reading its record is src/app/runHome.ts's.
import { join, resolve, sep } from "node:path";

/** The directory phax keeps its own files in, and where that came from. */
export interface PhaxHome {
  readonly path: string;
  readonly from: "PHAX_HOME" | "default";
}

/** The files phax reads from its home. */
type PhaxHomeFileName = "config.json" | "providers.json" | "model-routing.json" | "telemetry.json";

/** The absolute path of `name` inside `home`. */
export function phaxHomeFile(home: PhaxHome, name: PhaxHomeFileName): string {
  return join(home.path, name);
}

/** The line a command says on stderr when PHAX_HOME moved the home; nothing for the default. */
export function phaxHomeNotice(home: PhaxHome): string | undefined {
  return home.from === "PHAX_HOME" ? `phax home: ${home.path} (PHAX_HOME)` : undefined;
}

/** The refusal of a PHAX_HOME that is not an absolute path to a directory. */
export function invalidPhaxHomeMessage(value: string): string {
  return `PHAX_HOME must be an absolute path to a directory, got "${value}"`;
}

// ── The home pinned to a run ────────────────────────────────────────────────────

/** The run folder's record of the home `phax run` started with. */
const RUN_HOME_FILE = "phax-home.json";

/** The record of the run whose folder is `runPath`. */
export function runHomeFile(runPath: string): string {
  return join(runPath, RUN_HOME_FILE);
}

/** Whether two absolute paths name the same home once normalised (`.`/`..`, repeated and
 *  trailing slashes). Symlinks are not followed. */
export function samePhaxHomePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

/** Whether a write grant on `entry` reaches `target`: the same path, or an ancestor of it. */
export function pathCovers(entry: string, target: string): boolean {
  const from = resolve(entry);
  const to = resolve(target);
  if (from === to) return true;
  return to.startsWith(from === sep ? from : `${from}${sep}`);
}

/** A directory that sits where a run's phase worktree sits, and the run folder beside it. */
export interface RunWorktreeCandidate {
  /** `<root>/worktrees/<key>/<phase>`. */
  readonly worktree: string;
  /** `<root>/runs/<key>`. */
  readonly runPath: string;
}

/**
 * Every ancestor of the absolute `path` (itself included) shaped like a run's phase worktree,
 * `<root>/worktrees/<key>/<phase>`, with the run folder `<root>/runs/<key>` it would belong to;
 * outermost first. Which of them is a run's worktree (its run-status.json exists) is the
 * caller's to check.
 */
export function runWorktreeCandidates(path: string): readonly RunWorktreeCandidate[] {
  const segments = resolve(path)
    .split(sep)
    .filter((segment) => segment.length > 0);
  const candidates: RunWorktreeCandidate[] = [];
  // segments[i] is the phase, segments[i - 1] the key, segments[i - 2] "worktrees".
  for (let i = 2; i < segments.length; i++) {
    if (segments[i - 2] !== "worktrees") continue;
    const root = sep + segments.slice(0, i - 2).join(sep);
    const key = segments[i - 1] ?? "";
    candidates.push({
      worktree: sep + segments.slice(0, i + 1).join(sep),
      runPath: join(root, "runs", key),
    });
  }
  return candidates;
}

/** The refusal of a run whose home record is missing. */
export function missingRunHomeMessage(file: string): string {
  return `this run's phax home record "${file}" is missing: a run started before phax recorded its home cannot be used from its phase worktrees or resumed`;
}

/** The refusal of a run whose home record does not read or decode. */
export function undecodableRunHomeMessage(file: string, detail: string): string {
  return `this run's phax home record "${file}" does not decode: ${detail}`;
}

/** The refusal of a PHAX_HOME that differs from the home of the run whose worktree holds the cwd. */
export function differingPhaxHomeMessage(value: string, recorded: string): string {
  return `PHAX_HOME "${value}" differs from this run's phax home "${recorded}"`;
}

/** The refusal of `phax resume` under a home other than the run's, and how to fix it. */
export function resumeHomeMismatchMessage(recorded: PhaxHome, current: PhaxHome): string {
  const fix =
    recorded.from === "PHAX_HOME"
      ? `Set PHAX_HOME to "${recorded.path}" and resume again.`
      : `This run started on the default home: unset PHAX_HOME and resume again.`;
  return [
    `this run's phax home is "${recorded.path}", but the current phax home is "${current.path}"`,
    fix,
  ].join("\n");
}
