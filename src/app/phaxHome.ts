// The one point that resolves phax's home: PHAX_HOME when it is set, else ~/.phax. It reads the
// environment and the user's home on every call; nothing is cached at module load, so a moved
// HOME or PHAX_HOME is seen by the next call.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Result } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import { type PhaxHome, invalidPhaxHomeMessage } from "../domain/phaxHome.js";
import { decodePhaxHomeVariable } from "../schemas/phaxHome.js";

/**
 * phax's home for this call. Unset PHAX_HOME gives `<user home>/.phax`. A set PHAX_HOME must be
 * an absolute path; one that exists must be a directory (symlinks followed). One that does not
 * exist yet is accepted: it is created on first write. Anything else is a ConfigValidationError
 * on path `PHAX_HOME`.
 */
export function resolvePhaxHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
): Result.Result<PhaxHome, ConfigValidationError> {
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

function refuse(value: string): Result.Result<never, ConfigValidationError> {
  return Result.fail(
    new ConfigValidationError({ message: invalidPhaxHomeMessage(value), path: "PHAX_HOME" }),
  );
}
