import { Command } from "commander";
import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig, locatePhaxConfig } from "../../app/loadConfig.js";
import { configureRecords } from "../../app/configureRecords.js";
import {
  reconcileRecordsSync,
  recordsClonePath,
  type RecordsSyncResult,
} from "../../app/recordsSync.js";
import { computeRecordsPending, groupPendingByRun } from "../../app/recordsStatus.js";
import { readRegistry } from "../../app/registry.js";
import { PromptCancelled } from "../../ports/prompt.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeRepoRootedFileSystemLayer } from "./runLayers.js";

interface RecordsInitOptions {
  force?: boolean;
}

async function runRecordsInit(opts: RecordsInitOptions, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(configResult.left.message);
    return 2;
  }
  const config = configResult.right;

  const configPath = locatePhaxConfig(process.cwd());
  if (configPath === undefined) {
    out.error("Could not find phax.json. Run `phax init` first.");
    return 2;
  }

  const effect = configureRecords({
    configPath,
    repoRoot: config.repoRoot,
    stateRoot: config.stateRoot,
    namespace: config.namespace,
    ...(opts.force !== undefined ? { force: opts.force } : {}),
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        makeClackPromptLayer(),
        makeRepoRootedFileSystemLayer(config),
        NodeGitLayer,
        NodeGitHubLayer,
      ),
    ),
  );

  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    const err = result.left;
    if (err instanceof PromptCancelled) {
      out.log("phax records init aborted — no changes written.");
      return 0;
    }
    out.error(err.message);
    return 1;
  }

  const outcome = result.right;

  if (outcome.kind === "already_configured") {
    out.error(`Records are already configured in ${outcome.configPath}`);
    out.error("Use --force to reconfigure.");
    return 1;
  }

  out.log(`Configured records in ${outcome.configPath}`);
  reportSyncResult(outcome.sync, out);
  return 0;
}

async function runRecordsSync(_opts: Record<string, never>, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(configResult.left.message);
    return 2;
  }
  const config = configResult.right;

  if (!config.records.enabled) {
    out.log("Records are not configured for this project. Run `phax records init` first.");
    return 0;
  }

  const effect = reconcileRecordsSync({
    records: config.records,
    stateRoot: config.stateRoot,
    namespace: config.namespace,
  }).pipe(Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeGitLayer)));

  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 1;
  }

  return reportSyncResult(result.right, out);
}

async function runRecordsStatus(_opts: Record<string, never>, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(configResult.left.message);
    return 2;
  }
  const config = configResult.right;

  if (!config.records.enabled) {
    out.log("Records are not configured for this project. Run `phax records init` first.");
    return 0;
  }

  const recordsClonePathValue =
    config.records.destination.kind === "repo"
      ? recordsClonePath(config.stateRoot, config.namespace)
      : undefined;

  const effect = Effect.gen(function* () {
    const pending = yield* computeRecordsPending({
      records: config.records,
      repoRoot: config.repoRoot,
      publishRemote: config.publish.remote,
      ...(recordsClonePathValue !== undefined ? { recordsClonePath: recordsClonePathValue } : {}),
    });
    const registry = yield* readRegistry(config.stateRoot);
    return { pending, runs: groupPendingByRun(pending, registry) };
  }).pipe(Effect.provide(Layer.mergeAll(makeRepoRootedFileSystemLayer(config), NodeGitLayer)));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 1;
  }

  const { pending, runs } = result.right;
  const destinationLabel =
    pending.destination.kind === "in-repo"
      ? `in-repo (${pending.localPath}, remote "${pending.remote}")`
      : `repo "${pending.destination.remote}" (local clone: ${pending.localPath})`;
  out.log(`Records destination: ${destinationLabel}`);

  if (runs.length === 0) {
    out.log("All records are pushed. Nothing pending.");
    return 0;
  }

  out.log(`Pending: ${pending.pending.length} record(s) across ${runs.length} run(s)`);
  for (const run of runs) {
    out.log(`  ${run.shortName} (${run.phaseIds.join(", ")})`);
  }
  return 0;
}

function reportSyncResult(sync: RecordsSyncResult, out: OutputPort): number {
  switch (sync.kind) {
    case "nothing-to-bootstrap":
      out.log("Records destination is in-repo; nothing to sync.");
      return 0;
    case "cloned":
      out.log(`Cloned records into ${sync.path}`);
      return 0;
    case "fetched":
      out.log(`Fetched records into ${sync.path}`);
      return 0;
    case "refused":
      out.error(sync.message);
      out.error(sync.remedy);
      return 1;
  }
}

export function registerRecordsCommand(program: Command, out: OutputPort): void {
  const records = program.command("records").description("Manage phax run records");

  records
    .command("init")
    .description("Configure records for this project (transcript, destination, auto-push)")
    .option("--force", "Reconfigure records even if already configured")
    .action(async (opts: RecordsInitOptions) => {
      const exitCode = await runRecordsInit(opts, out);
      process.exit(exitCode);
    });

  records
    .command("sync")
    .description("Bring the local records clone in line with its configured remote")
    .action(async () => {
      const exitCode = await runRecordsSync({}, out);
      process.exit(exitCode);
    });

  records
    .command("status")
    .description("Show pending (unpushed) records, by run and phase")
    .action(async () => {
      const exitCode = await runRecordsStatus({}, out);
      process.exit(exitCode);
    });
}
