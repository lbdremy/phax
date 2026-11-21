import { boundedSpawn, CLI_LAUNCHER, cliArgs } from "../../helpers/boundedSpawn.js";

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

export function runCli(args: string[], cwd: string, opts: RunCliOptions): CliResult {
  const result = boundedSpawn(CLI_LAUNCHER, cliArgs(...args), {
    cwd,
    boundMs: opts.boundMs,
    env: { ...process.env, ...opts.env },
  });
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}
