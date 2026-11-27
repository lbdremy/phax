import {
  boundedSpawn,
  BoundedSpawnError,
  CLI_LAUNCHER,
  cliArgs,
} from "../../helpers/boundedSpawn.js";
import { printArtifacts } from "./artifacts.js";
import { tempPhaxHomeOf, type TempEnv } from "./tempEnv.js";

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The bound of a real-provider CLI call: today's default of five minutes. */
export const E2E_CLI_BOUND_MS = 300_000;

export interface RunCliOptions {
  /** The call's bound in ms, required. A bound reached, or any signal ending, throws. */
  readonly boundMs: number;
  /** Variables merged over the process environment. HOME and PHAX_HOME are refused. */
  readonly env?: Readonly<Record<string, string>>;
}

// The repositories whose CLI call threw: their temporary environment is kept for reading.
const threwIn = new Set<string>();

/** Whether a CLI call in `repoDir` threw: its environment is then kept, not removed. */
export function cliThrewIn(repoDir: string): boolean {
  return threwIn.has(repoDir);
}

/**
 * The environment of a phax child: the process environment, then `extra`, then PHAX_HOME set to
 * the temporary phax home. HOME is never changed, so the provider CLIs keep their sign-ins; an
 * `extra` naming HOME or PHAX_HOME throws.
 */
export function childEnvironment(
  phaxHome: string,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  for (const name of ["HOME", "PHAX_HOME"]) {
    if (Object.hasOwn(extra, name)) {
      throw new Error(
        `runCli: the child's ${name} is not the suite's to set: HOME stays the user's and PHAX_HOME is the TempEnv's`,
      );
    }
  }
  return { ...process.env, ...extra, PHAX_HOME: phaxHome };
}

/**
 * Run the CLI in the environment's repository, with PHAX_HOME at its temporary phax home. An
 * argument createTempEnv did not return, or whose home is gone, throws before anything is spawned.
 * A call that reaches its bound, or ends by a signal, throws: before it does, the run's artifacts
 * are printed and its temporary environment is kept, as a non-zero exit lets the caller do.
 */
export function runCli(args: string[], env: TempEnv, opts: RunCliOptions): CliResult {
  const phaxHome = tempPhaxHomeOf(env);
  const childEnv = childEnvironment(phaxHome, opts.env);
  try {
    const result = boundedSpawn(CLI_LAUNCHER, cliArgs(...args), {
      cwd: env.repoDir,
      boundMs: opts.boundMs,
      env: childEnv,
    });
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof BoundedSpawnError) {
      threwIn.add(env.repoDir);
      printArtifacts(
        { repoDir: env.repoDir, phaxHome },
        `phax ${args.join(" ")} did not exit on its own:\n${error.message}`,
      );
    }
    throw error;
  }
}
