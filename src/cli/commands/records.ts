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
import {
  explainRecord,
  type ExplainedRecord,
  type ExplainOutcome,
} from "../../app/recordsExplain.js";
import { listRecords } from "../../app/recordsList.js";
import { readRegistry } from "../../app/registry.js";
import { PromptCancelled } from "../../ports/prompt.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import { NodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { NodeShellLayer } from "../../infra/shell.js";
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

interface RecordsExplainOptions {
  prompt?: boolean;
  diff?: boolean;
  transcript?: boolean;
  gates?: boolean;
}

async function runRecordsExplain(
  sha: string,
  opts: RecordsExplainOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(configResult.left.message);
    return 2;
  }
  const config = configResult.right;

  const recordsClonePathValue =
    config.records.destination.kind === "repo"
      ? recordsClonePath(config.stateRoot, config.namespace)
      : undefined;

  const effect = explainRecord({
    sha,
    repoRoot: config.repoRoot,
    records: config.records,
    publishRemote: config.publish.remote,
    ...(recordsClonePathValue !== undefined ? { recordsClonePath: recordsClonePathValue } : {}),
  }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer)));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 1;
  }

  return renderExplainOutcome(result.right, opts, out);
}

function formatBytes(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(1)} KB`;
}

function renderExplainOutcome(
  outcome: ExplainOutcome,
  opts: RecordsExplainOptions,
  out: OutputPort,
): number {
  switch (outcome.kind) {
    case "records-disabled":
      out.log("Records are not configured for this project. Run `phax records init` first.");
      return 0;
    case "commit-not-found":
      out.error(`Commit "${outcome.sha}" was not found in this repository.`);
      return 1;
    case "not-phax-commit":
      out.error(
        `Commit "${outcome.sha}" was not produced by a phax phase (no Run-Id/Phase-Id trailers).`,
      );
      return 1;
    case "not-found":
      if (outcome.remoteConsulted) {
        out.error(
          `No record found for ${outcome.runId}/${outcome.phaseId} (checked local and remote).`,
        );
      } else {
        out.error("No record found locally; the remote was not consulted (offline).");
      }
      return 1;
    case "found":
      return renderFoundRecord(outcome.record, opts, out);
  }
}

function printArtifact(record: ExplainedRecord, name: string, out: OutputPort): void {
  const bytes = record.artifacts.get(name);
  if (bytes === undefined) {
    out.log(`(${name} not present in this record)`);
    return;
  }
  out.log(new TextDecoder().decode(bytes));
}

function renderFoundRecord(
  record: ExplainedRecord,
  opts: RecordsExplainOptions,
  out: OutputPort,
): number {
  const { manifest } = record;

  out.log(`${record.phaseId} · ${manifest.provider} (${manifest.model}, ${manifest.effort})`);
  out.log(`run      ${manifest.runId}`);

  const shapeLabel =
    manifest.shape === "full"
      ? `full (transcript ${formatBytes(record.artifacts.get("output.jsonl")?.length ?? 0)})`
      : "skeleton (no transcript)";
  const usageLabel = manifest.usage.available
    ? `tokens ${manifest.usage.usage.inputTokens.toLocaleString()} in / ${manifest.usage.usage.outputTokens.toLocaleString()} out`
    : "tokens unavailable";
  out.log(`record   ${shapeLabel}   ${usageLabel}`);

  out.log(`gates    ${manifest.outcome} after ${record.checksAttemptCount} attempt(s)`);

  if (manifest.sourceSha !== undefined) {
    const reachability =
      record.sourceCommitReachable === true ? "reachable" : "not reachable — rebased or squashed";
    out.log(`source   ${manifest.sourceSha} (${reachability})`);
  } else {
    out.log("source   (none — phase did not commit)");
  }

  const promptLabel =
    record.promptByteLength !== undefined ? `${record.promptByteLength} bytes` : "absent";
  const diffLabel =
    record.diffStat !== undefined
      ? `${record.diffStat.files} files, +${record.diffStat.insertions} -${record.diffStat.deletions}`
      : "absent";
  const handoffLabel = record.handoffPresent ? "present" : "absent";
  out.log(`prompt   ${promptLabel}   diff  ${diffLabel}   handoff  ${handoffLabel}`);

  if (opts.prompt === true) printArtifact(record, "prompt.md", out);
  if (opts.diff === true) printArtifact(record, "diff.patch", out);
  if (opts.transcript === true) printArtifact(record, "output.jsonl", out);
  if (opts.gates === true) {
    for (const [name, bytes] of record.artifacts) {
      if (/^checks-attempt-\d+\.log$/.test(name)) {
        out.log(`--- ${name} ---`);
        out.log(new TextDecoder().decode(bytes));
      }
    }
  }

  return 0;
}

interface RecordsListOptions {
  run?: string;
}

async function runRecordsList(opts: RecordsListOptions, out: OutputPort): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(configResult.left.message);
    return 2;
  }
  const config = configResult.right;

  const recordsClonePathValue =
    config.records.destination.kind === "repo"
      ? recordsClonePath(config.stateRoot, config.namespace)
      : undefined;

  const effect = listRecords({
    records: config.records,
    repoRoot: config.repoRoot,
    publishRemote: config.publish.remote,
    ...(recordsClonePathValue !== undefined ? { recordsClonePath: recordsClonePathValue } : {}),
    ...(opts.run !== undefined ? { runId: opts.run } : {}),
  }).pipe(Effect.provide(Layer.mergeAll(NodeGitLayer, NodeShellLayer)));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 1;
  }

  const outcome = result.right;
  if (outcome.kind === "disabled") {
    out.log("Records are not configured for this project. Run `phax records init` first.");
    return 0;
  }
  if (outcome.records.length === 0) {
    out.log("No records found.");
    return 0;
  }

  for (const entry of outcome.records) {
    out.log(
      `${entry.runId}  ${entry.phaseId}  ${entry.shape}  ${entry.outcome}  ${entry.recordCommitSha.slice(0, 8)}`,
    );
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

  records
    .command("list")
    .description("List records present, by run and phase")
    .option("--run <id>", "Only show records for this run id")
    .action(async (opts: RecordsListOptions) => {
      const exitCode = await runRecordsList(opts, out);
      process.exit(exitCode);
    });

  records
    .command("explain")
    .description(
      "Explain a commit from its record: prompt, diff, gates, handoff, transcript, usage",
    )
    .argument("<sha>", "Commit sha in the source repository")
    .option("--prompt", "Print the full prompt")
    .option("--diff", "Print the full diff")
    .option("--transcript", "Print the full transcript")
    .option("--gates", "Print the gate check logs")
    .action(async (sha: string, opts: RecordsExplainOptions) => {
      const exitCode = await runRecordsExplain(sha, opts, out);
      process.exit(exitCode);
    });
}
