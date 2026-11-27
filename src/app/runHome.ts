// The phax home pinned to a run. `phax run` records the home it started with in the run folder
// (phax-home.json, written by createRunFolder). A process whose cwd is inside one of the run's
// phase worktrees is pinned to that record at its entry (src/cli/main.ts); `phax resume` and the
// commands that open a session for an existing run read it too. A missing record is refused like
// an undecodable one: no call falls back to the default home.
//
// A run's phase worktree is recognised from its location alone: `<root>/worktrees/<key>/<phase>`
// whose `<root>/runs/<key>/run-status.json` exists, on the real path of the cwd. Not from git,
// not from `.phax-context/` (a session can delete it) and not from the loaded config (the state
// root itself depends on the home).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { Result } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import {
  type PhaxHome,
  missingRunHomeMessage,
  resumeHomeMismatchMessage,
  runHomeFile,
  runWorktreeCandidates,
  samePhaxHomePath,
  undecodableRunHomeMessage,
  type RunWorktreeCandidate,
} from "../domain/phaxHome.js";
import { decodeRunHome } from "../schemas/runHome.js";
import { pinPhaxHome, resolvePhaxHome } from "./phaxHome.js";

/**
 * The run phase worktree holding `cwd`, by location: the outermost ancestor of the cwd's real
 * path shaped `<root>/worktrees/<key>/<phase>` whose `<root>/runs/<key>/run-status.json` exists.
 * The outermost, so a look-alike tree built inside a worktree never overrides the real one.
 * Undefined outside every run's phase worktree, or when the cwd cannot be resolved.
 */
function locateRunWorktree(cwd: string): RunWorktreeCandidate | undefined {
  let real: string;
  try {
    real = realpathSync(cwd);
  } catch {
    return undefined;
  }
  return runWorktreeCandidates(real).find((candidate) =>
    existsSync(join(candidate.runPath, "run-status.json")),
  );
}

/**
 * The home recorded in the run folder `runPath`. A missing record, one that does not read, does
 * not parse or does not decode is a ConfigValidationError on path `PHAX_HOME` naming the file.
 */
export function readRunHome(runPath: string): Result.Result<PhaxHome, ConfigValidationError> {
  const file = runHomeFile(runPath);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return refuse(missingRunHomeMessage(file));
    return refuse(undecodableRunHomeMessage(file, messageOf(error)));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return refuse(undecodableRunHomeMessage(file, messageOf(error)));
  }
  const decoded = decodeRunHome(raw);
  if (Result.isFailure(decoded))
    return refuse(undecodableRunHomeMessage(file, decoded.failure.message));
  return Result.succeed(decoded.success);
}

/**
 * Pins this process's phax home to the run whose phase worktree holds `cwd`: its recorded home,
 * or the refusal of a missing or undecodable record, or of a PHAX_HOME in `env` that differs.
 * Nothing outside every run's phase worktree. Called once, at the process entry
 * (src/cli/main.ts), before the runner reads the call; never inside the program or a use case.
 */
export function pinRunHome(cwd: string, env: NodeJS.ProcessEnv): void {
  const worktree = locateRunWorktree(cwd);
  if (worktree === undefined) return;
  pinPhaxHome(readRunHome(worktree.runPath), env);
}

/**
 * `phax resume`'s check, before it changes anything: the run's recorded home must be the current
 * one. A missing or undecodable record, or a differing current home, is a ConfigValidationError
 * on path `PHAX_HOME`; the differing case names both homes and how to get back to the recorded
 * one. Answers the recorded home.
 */
export function checkResumeHome(runPath: string): Result.Result<PhaxHome, ConfigValidationError> {
  return Result.flatMap(readRunHome(runPath), (recorded) =>
    Result.flatMap(resolvePhaxHome(), (current) =>
      samePhaxHomePath(recorded.path, current.path)
        ? Result.succeed(recorded)
        : Result.fail(
            new ConfigValidationError({
              message: resumeHomeMismatchMessage(recorded, current),
              path: "PHAX_HOME",
            }),
          ),
    ),
  );
}

/** A refusal of the run's home, on path `PHAX_HOME` (exit 2). */
function refuse(message: string): Result.Result<never, ConfigValidationError> {
  return Result.fail(new ConfigValidationError({ message, path: "PHAX_HOME" }));
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
