import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { getSecurityStatus, formatSecurityStatusReport } from "../../app/securityStatus.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { Command } from "commander";

interface SecurityCommandOptions {
  verbose?: boolean;
  trace?: boolean;
}

async function runSecurityStatus(_opts: SecurityCommandOptions, out: OutputPort): Promise<number> {
  const providerConfigEffect = loadProviderConfig().pipe(
    Effect.provide(NodeFileSystemLayer),
    Effect.provide(NodeShellLayer),
  );

  const providerConfigResult = await Effect.runPromise(Effect.either(providerConfigEffect));

  if (Either.isLeft(providerConfigResult)) {
    out.error(`Failed to load provider config: ${providerConfigResult.left.message}`);
    return 2;
  }

  const report = await Effect.runPromise(
    getSecurityStatus(providerConfigResult.right).pipe(Effect.provide(NodeShellLayer)),
  );

  out.log(formatSecurityStatusReport(report));
  return 0;
}

export function registerSecurityCommand(
  program: Command,
  out: OutputPort,
  globalTraceOpts: () => { verbose?: boolean; trace?: boolean },
): void {
  program
    .command("security")
    .description("Security-related commands")
    .option("--verbose", "Print human-readable progress and system events")
    .option("--trace", "Write structured JSONL trace events to the run folder")
    .action(async (opts: { verbose?: boolean; trace?: boolean }) => {
      const merged = { ...opts, ...globalTraceOpts() };
      const exitCode = await runSecurityStatus(merged, out);
      process.exit(exitCode);
    });

  program
    .command("security status")
    .description("Show provider security capabilities and availability")
    .option("--verbose", "Print human-readable progress and system events")
    .option("--trace", "Write structured JSONL trace events to the run folder")
    .action(async (opts: { verbose?: boolean; trace?: boolean }) => {
      const merged = { ...opts, ...globalTraceOpts() };
      const exitCode = await runSecurityStatus(merged, out);
      process.exit(exitCode);
    });
}
