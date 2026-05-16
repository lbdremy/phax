import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(dir, "../../..");
const CLI_ENTRY = join(PROJECT_ROOT, "src", "cli", "main.ts");
const TSX_BIN = join(PROJECT_ROOT, "node_modules", ".bin", "tsx");

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface RunCliOptions {
  timeout?: number;
}

export function runCli(args: string[], cwd: string, opts: RunCliOptions = {}): CliResult {
  const timeout = opts.timeout ?? 300_000;
  const result = spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env },
  });

  const timedOut = result.signal === "SIGTERM" || result.status === null;

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
  };
}
