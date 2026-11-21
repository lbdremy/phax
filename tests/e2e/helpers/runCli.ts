import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boundedSpawn,
  BoundedSpawnError,
  CLI_LAUNCHER,
  cliArgs,
} from "../../helpers/boundedSpawn.js";
import { printArtifacts } from "./artifacts.js";

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
  /** Variables merged over the process environment. */
  readonly env?: Readonly<Record<string, string>>;
}

// The repositories whose CLI call threw: their temporary environment is kept for reading.
const threwIn = new Set<string>();

/** Whether a CLI call in `repoDir` threw: its environment is then kept, not removed. */
export function cliThrewIn(repoDir: string): boolean {
  return threwIn.has(repoDir);
}

/**
 * Run the CLI in `cwd`. A call that reaches its bound, or ends by a signal, throws: before it
 * does, the run's artifacts are printed and its temporary environment is kept, as a non-zero exit
 * lets the caller do.
 */
export function runCli(args: string[], cwd: string, opts: RunCliOptions): CliResult {
  try {
    const result = boundedSpawn(CLI_LAUNCHER, cliArgs(...args), {
      cwd,
      boundMs: opts.boundMs,
      env: { ...process.env, ...opts.env },
    });
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof BoundedSpawnError) {
      threwIn.add(cwd);
      printArtifacts(
        { repoDir: cwd, phaxHome: stateRootOf(cwd) },
        `phax ${args.join(" ")} did not exit on its own:\n${error.message}`,
      );
    }
    throw error;
  }
}

// The PHAX_HOME a temporary repository points at: its phax.json's state.root.
function stateRootOf(repoDir: string): string {
  try {
    const config: unknown = JSON.parse(readFileSync(join(repoDir, "phax.json"), "utf8"));
    const state: unknown =
      typeof config === "object" && config !== null ? Reflect.get(config, "state") : undefined;
    const root: unknown =
      typeof state === "object" && state !== null ? Reflect.get(state, "root") : undefined;
    return typeof root === "string" ? root : "(unknown)";
  } catch {
    return "(unknown)";
  }
}
