import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import type { ShortName, RunId } from "../domain/branded.js";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import { type RunStatus } from "../schemas/status.js";
import { upsertRun } from "./registry.js";
import { RegistryCorruptionError } from "../domain/errors.js";
import { runKey } from "../domain/runRef.js";

function makeRunId(shortName: ShortName): RunId {
  return `${shortName}-${Date.now()}` as RunId;
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface RunFolderResult {
  runPath: string;
  runId: RunId;
}

export function createRunFolder(
  shortName: ShortName,
  planMd: string,
  plan: PhaxPlan,
  config: ResolvedConfig,
): Effect.Effect<RunFolderResult, FsError | RegistryCorruptionError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;

    const runId = makeRunId(shortName);
    const namespace = config.namespace;
    const runPath = join(config.stateRoot, "runs", runKey(namespace, shortName));

    yield* fs.mkdirp(runPath);

    yield* fs.writeAtomic(join(runPath, "plan.md"), planMd);

    yield* fs.writeAtomic(join(runPath, "phax-plan.json"), JSON.stringify(plan, null, 2));

    yield* fs.writeAtomic(join(runPath, "phax.json"), JSON.stringify(config.raw, null, 2));

    const now = nowIso();
    const runStatus: RunStatus = {
      version: 1,
      namespace,
      shortName,
      runId,
      state: "created",
      createdAt: now,
      updatedAt: now,
      phasesCount: plan.phases.length,
    };

    yield* fs.writeAtomic(join(runPath, "run-status.json"), JSON.stringify(runStatus, null, 2));

    yield* upsertRun(config.stateRoot, {
      namespace,
      shortName,
      runId,
      state: "created",
      branch: plan.run.branch,
      projectName: config.namespace,
      phasesCount: plan.phases.length,
      createdAt: now,
      updatedAt: now,
    });

    return { runPath, runId };
  });
}
