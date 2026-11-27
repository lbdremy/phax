// The one point that resolves phax's home: PHAX_HOME when it is set, else ~/.phax. It reads the
// environment and the user's home on every call; nothing is cached at module load, so a moved
// HOME or PHAX_HOME is seen by the next call.
//
// One exception: a process whose cwd is inside one of a run's phase worktrees is pinned to that
// run's recorded home at its entry (src/cli/main.ts, through pinRunHome in src/app/runHome.ts).
// From then on every call answers the pin: the recorded home, or the pin's refusal.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Result } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import {
  type PhaxHome,
  differingPhaxHomeMessage,
  invalidPhaxHomeMessage,
  samePhaxHomePath,
} from "../domain/phaxHome.js";
import { decodePhaxHomeVariable } from "../schemas/phaxHome.js";

type ResolvedPhaxHome = Result.Result<PhaxHome, ConfigValidationError>;

/** The answer of every call once the process is pinned to a run's home; unset otherwise. */
let pinned: ResolvedPhaxHome | undefined;

/**
 * phax's home for this call. Unset PHAX_HOME gives `<user home>/.phax`. A set PHAX_HOME must be
 * an absolute path; one that exists must be a directory (symlinks followed). One that does not
 * exist yet is accepted: it is created on first write. Anything else is a ConfigValidationError
 * on path `PHAX_HOME`. Under a pin (`pinPhaxHome`), the pin's answer.
 */
export function resolvePhaxHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): ResolvedPhaxHome {
  if (pinned !== undefined) return pinned;
  const raw = env["PHAX_HOME"];
  const decoded = decodePhaxHomeVariable(raw);
  if (Result.isFailure(decoded)) return refuse(raw ?? "");
  const variable = decoded.success;
  if (variable.kind === "unset")
    return Result.succeed({ path: join(userHome, ".phax"), from: "default" });
  let isDirectoryOrAbsent: boolean;
  try {
    const stat = statSync(variable.path, { throwIfNoEntry: false });
    isDirectoryOrAbsent = stat === undefined || stat.isDirectory();
  } catch {
    // ENOTDIR (a parent is a file), EACCES, ELOOP: not a usable directory.
    isDirectoryOrAbsent = false;
  }
  if (!isDirectoryOrAbsent) return refuse(variable.path);
  return Result.succeed({ path: variable.path, from: "PHAX_HOME" });
}

/**
 * Pins every later `resolvePhaxHome` call of this process to a run's home: `recorded` is the
 * run's record, or the refusal of a missing or undecodable one. A PHAX_HOME in `env` is accepted
 * only when it is valid and names the recorded path; otherwise the pin is its refusal. Called
 * once, at the process entry; never by a use case or a test running in-process.
 */
export function pinPhaxHome(recorded: ResolvedPhaxHome, env: NodeJS.ProcessEnv): void {
  pinned = Result.flatMap(recorded, (home): ResolvedPhaxHome => {
    const raw = env["PHAX_HOME"];
    const decoded = decodePhaxHomeVariable(raw);
    if (Result.isFailure(decoded)) return refuse(raw ?? "");
    const variable = decoded.success;
    if (variable.kind === "set" && !samePhaxHomePath(variable.path, home.path)) {
      return Result.fail(
        new ConfigValidationError({
          message: differingPhaxHomeMessage(variable.path, home.path),
          path: "PHAX_HOME",
        }),
      );
    }
    return Result.succeed(home);
  });
}

function refuse(value: string): Result.Result<never, ConfigValidationError> {
  return Result.fail(
    new ConfigValidationError({ message: invalidPhaxHomeMessage(value), path: "PHAX_HOME" }),
  );
}
