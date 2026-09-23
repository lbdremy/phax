import { Effect } from "effect";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { selectRecordArtifacts } from "../domain/records/assemble.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { type Git, type GitError } from "../ports/git.js";
import { type GitHub } from "../ports/github.js";
import {
  encodeAuthoringRecordManifest,
  type AuthoringRecordManifest,
  type AuthoringRecordOutcome,
} from "../schemas/authoringRecord.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  commitRecordTree,
  computeRecordUsage,
  RECORD_TRANSCRIPT_FILE,
  resolveRecordDestination,
  type RecordWriteResult,
} from "./recordPlumbing.js";

/** The session-folder files an authoring record may carry; anything else there is not recorded. */
const AUTHORING_RECORD_FILES: readonly string[] = [
  "brief.md",
  "prompt.md",
  "document.json",
  RECORD_TRANSCRIPT_FILE,
];

export interface WriteAuthoringRecordInput {
  /** The source repository; receives the commit for an `in-repo` destination. */
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  /** `<stateRoot>/authoring/<authoringId>/`, the session folder. */
  readonly sessionFolder: string;
  /** `<stamp>-<slug>`: the record key's second component and the `Authoring-Id` trailer. */
  readonly authoringId: string;
  /** Repo-relative path of the artifact the session authored (or would have). */
  readonly artifact: string;
  readonly artifactKind: ArtifactKind;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly outcome: AuthoringRecordOutcome;
  readonly records: ResolvedRecordsConfig;
  /** The artifact commit; absent when the session did not commit. */
  readonly sourceSha?: string | undefined;
  /** The agent session id, used to locate a vibe session's `meta.json` for usage. */
  readonly sessionId?: string | undefined;
  readonly vibeHome?: string | undefined;
}

export type WriteAuthoringRecordResult = RecordWriteResult;

export function authoringRecordKey(authoringId: string): string {
  return `authoring/${authoringId}`;
}

/**
 * Write one headless authoring session's record as one commit on
 * `phax/records/v1`, keyed `authoring/<authoringId>`: the brief, the prompt,
 * the accepted document when there is one, and the transcript per
 * `records.transcript`, plus an authoring manifest. Same destination policy,
 * usage extraction and tree-only plumbing as a phase record; records off is a
 * total no-op.
 */
export function writeAuthoringRecord(
  input: WriteAuthoringRecordInput,
): Effect.Effect<WriteAuthoringRecordResult, GitError | FsError, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    const destination = yield* resolveRecordDestination(input);
    if (destination.kind !== "write") return destination;

    const fs = yield* FileSystem;
    const listed = yield* fs.list(input.sessionFolder);
    const { shape, artifactPaths } = selectRecordArtifacts(
      listed.filter((name) => AUTHORING_RECORD_FILES.includes(name)),
      input.records.transcript,
    );
    const usage = yield* computeRecordUsage({
      provider: input.provider,
      folder: input.sessionFolder,
      sessionId: input.sessionId,
      vibeHome: input.vibeHome,
    });

    const manifest: AuthoringRecordManifest = {
      version: 1,
      kind: "authoring",
      authoringId: input.authoringId,
      artifact: input.artifact,
      artifactKind: input.artifactKind,
      shape,
      ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha } : {}),
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      outcome: input.outcome,
      usage,
    };

    const key = authoringRecordKey(input.authoringId);
    const message = [
      `records(authoring): ${input.outcome}`,
      "",
      `Authoring-Id: ${input.authoringId}`,
      `Artifact: ${input.artifact}`,
      `Shape: ${shape}`,
    ].join("\n");

    const { commitSha, branch, fileCount } = yield* commitRecordTree({
      repo: destination.repo,
      folder: input.sessionFolder,
      key,
      artifactPaths,
      manifest: encodeAuthoringRecordManifest(manifest),
      message,
    });

    return { kind: "written", commitSha, branch, key, shape, fileCount } as const;
  });
}
