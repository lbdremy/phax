import { Effect, Either, Layer } from "effect";
import type { Command } from "commander";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { backfillCostLedgers } from "../../app/costBackfill.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";

function grouped(value: number, decimals: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export async function runCostBackfill(out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const { stateRoot } = config;
  const layer = Layer.merge(makeRepoRootedFileSystemLayer(config), makeNodeLockLayer(stateRoot));

  const result = await Effect.runPromise(
    Effect.either(backfillCostLedgers({ stateRoot }).pipe(Effect.provide(layer))),
  );
  if (Either.isLeft(result)) {
    out.error(`phax cost backfill failed: ${result.left.message}`);
    return 1;
  }

  const { written, locked, missing } = result.right;
  if (written.length === 0) {
    out.log("nothing to backfill");
  } else {
    const invocations = written.reduce((sum, run) => sum + run.invocations, 0);
    const costUsd = written.reduce((sum, run) => sum + run.costUsd, 0);
    out.log(
      `wrote ${grouped(written.length, 0)} cost ledgers (${grouped(invocations, 0)} invocations, $${grouped(costUsd, 2)} API-list)`,
    );
  }
  if (locked.length > 0) {
    out.log(`skipped ${locked.length} locked run(s): ${locked.join(", ")}`);
  }
  if (missing.length > 0) {
    out.log(`skipped ${missing.length} run(s) with no run folder: ${missing.join(", ")}`);
  }
  return 0;
}

export function registerCostCommand(program: Command, out: OutputPort): void {
  const cost = program.command("cost").description("Manage the runs' cost ledgers");

  cost
    .command("backfill")
    .description("Write a cost ledger for every kept run that has none, from its kept streams")
    .action(async () => {
      const exitCode = await runCostBackfill(out);
      process.exit(exitCode);
    });
}
