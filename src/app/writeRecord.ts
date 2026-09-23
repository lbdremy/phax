import { Effect, Either } from "effect";
import { join } from "node:path";
import { assembleRecord } from "../domain/records/assemble.js";
import { verifiedSurfaces as computeVerifiedSurfaces } from "../domain/gate/verifiedSurfaces.js";
import { FileSystem, type FileSystemOps, type FsError } from "../ports/fs.js";
import { type Git, type GitError } from "../ports/git.js";
import { type GitHub } from "../ports/github.js";
import type { ProviderId } from "../schemas/providerId.js";
import { decodeGateAttribution } from "../schemas/gateAttribution.js";
import type { Surface } from "../schemas/phaxConfig.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import { encodeRunRecordManifest, type RecordPhaseOutcome } from "../schemas/runRecord.js";
import {
  commitRecordTree,
  computeRecordUsage,
  resolveRecordDestination,
  type RecordWriteResult,
} from "./recordPlumbing.js";

export { RECORDS_BRANCH_NAME } from "./recordPlumbing.js";

const GATE_ATTRIBUTION_FILE = "gate-attribution.json";

export interface WriteRecordInput {
  /** The source repository. Also where `phax/records/v1` receives the commit
   * when the destination is `in-repo`. */
  readonly repoRoot: string;
  /**
   * The local records clone's path (`recordsClonePath` in recordsSync.ts),
   * where `phax/records/v1` receives the commit when the destination is a
   * dedicated `repo` — required in that case, ignored for `in-repo`.
   */
  readonly recordsClonePath?: string | undefined;
  /** The phase's run-folder path (where its artifacts were written), not the worktree. */
  readonly phaseFolderPath: string;
  /** The record key's first component — the `Run-Id` the phase commit already carries. */
  readonly runId: string;
  /** The record key's second component — the `Phase-Id` the phase commit already carries. */
  readonly phaseId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly outcome: RecordPhaseOutcome;
  readonly records: ResolvedRecordsConfig;
  /** Back-reference recorded when the phase committed; absent for a phase that never did. */
  readonly sourceSha?: string | undefined;
  /** The agent session id, used to locate a vibe session's `meta.json` for usage. */
  readonly sessionId?: string | undefined;
  /** Overridable vibe home (`~/.vibe` by default) so tests can point at a fixture. */
  readonly vibeHome?: string | undefined;
}

export type WriteRecordResult = RecordWriteResult;

/**
 * Assemble a phase's record and write it as one commit on `phax/records/v1`,
 * keyed by `runId/phaseId`, without touching the working tree or index (the
 * plumbing from phase-03 drives a scratch index). Records off is a total
 * no-op. The commit lands on the source repo for an `in-repo` destination, or
 * on the local records clone (`recordsClonePath`) for a dedicated `repo`
 * destination — and only once the destination policy allows it (spec §5.4):
 * detection guards the configured choice, it never picks one.
 */
export function writeRecord(
  input: WriteRecordInput,
): Effect.Effect<WriteRecordResult, GitError | FsError, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    const destination = yield* resolveRecordDestination(input);
    if (destination.kind !== "write") return destination;

    const fs = yield* FileSystem;

    const files = yield* fs.list(input.phaseFolderPath);
    const usage = yield* computeRecordUsage({
      provider: input.provider,
      folder: input.phaseFolderPath,
      sessionId: input.sessionId,
      vibeHome: input.vibeHome,
    });
    const verifiedSurfacesForPhase = yield* computeVerifiedSurfacesForPhase(
      fs,
      input.phaseFolderPath,
    );

    const { manifest, artifactPaths } = assembleRecord({
      runId: input.runId,
      phaseId: input.phaseId,
      files,
      transcriptEnabled: input.records.transcript,
      ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
      model: input.model,
      effort: input.effort,
      provider: input.provider,
      outcome: input.outcome,
      usage,
      verifiedSurfaces: verifiedSurfacesForPhase,
    });

    const key = `${input.runId}/${input.phaseId}`;
    const message = [
      `records(${input.phaseId}): ${input.outcome}`,
      "",
      `Run-Id: ${input.runId}`,
      `Phase-Id: ${input.phaseId}`,
      `Shape: ${manifest.shape}`,
    ].join("\n");

    const { commitSha, branch, fileCount } = yield* commitRecordTree({
      repo: destination.repo,
      folder: input.phaseFolderPath,
      key,
      artifactPaths,
      manifest: encodeRunRecordManifest(manifest),
      message,
    });

    return { kind: "written", commitSha, branch, key, shape: manifest.shape, fileCount } as const;
  });
}

/**
 * Derive the phase's verified surfaces from its `gate-attribution.json`, using
 * the same semantics as the final report (phase-04): every executed step of a
 * surface must have passed. Absent or undecodable attribution (the gate never
 * ran, or the phase failed before it did) degrades to an empty set rather than
 * failing the record write.
 */
function computeVerifiedSurfacesForPhase(
  fs: FileSystemOps,
  phaseFolderPath: string,
): Effect.Effect<readonly Surface[], never> {
  return Effect.gen(function* () {
    const attributionPath = join(phaseFolderPath, GATE_ATTRIBUTION_FILE);
    const exists = yield* fs.exists(attributionPath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return [];
    const text = yield* fs.readText(attributionPath).pipe(Effect.orElseSucceed(() => ""));
    if (text === "") return [];
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return [];
    }
    const decoded = decodeGateAttribution(json);
    if (Either.isLeft(decoded)) return [];
    return computeVerifiedSurfaces(decoded.right);
  });
}
