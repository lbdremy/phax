import { Effect } from "effect";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { RETRY_PROMPT_FILENAME, RETRY_TRANSCRIPT_FILENAME } from "../domain/authoring/retry.js";
import { selectRecordArtifacts } from "../domain/records/assemble.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { type Git, type GitError } from "../ports/git.js";
import { type GitHub } from "../ports/github.js";
import {
  encodeAuthoringRecordManifest,
  type AuthoringRecordManifest,
  type AuthoringRecordOutcome,
  type AuthoringRecordRetry,
} from "../schemas/authoringRecord.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  commitRecordTree,
  computeSessionUsage,
  RECORD_TRANSCRIPT_FILE,
  resolveRecordDestination,
  type RecordWriteResult,
} from "./recordPlumbing.js";

/**
 * The session-folder files an authoring record may carry; anything else there
 * is not recorded. The retry's prompt and transcript exist only when the
 * session was retried.
 */
const AUTHORING_RECORD_FILES: readonly string[] = [
  "brief.md",
  "prompt.md",
  "document.json",
  RECORD_TRANSCRIPT_FILE,
  RETRY_PROMPT_FILENAME,
  RETRY_TRANSCRIPT_FILENAME,
];

/** The transcripts, kept or dropped together under `records.transcript`. */
const AUTHORING_TRANSCRIPT_FILES: ReadonlySet<string> = new Set([
  RECORD_TRANSCRIPT_FILE,
  RETRY_TRANSCRIPT_FILENAME,
]);

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
  /** Whether the session was resumed to retry a refused document. */
  readonly retry: AuthoringRecordRetry;
  readonly records: ResolvedRecordsConfig;
  /** The artifact commit; absent when the session did not commit. */
  readonly sourceSha?: string | undefined;
  /**
   * The agent session id, used to locate a vibe session's `meta.json` for
   * usage; withheld from every recorded artifact.
   */
  readonly sessionId?: string | undefined;
  /** The session id the retry reported; absent when there was no retry or it failed. */
  readonly retrySessionId?: string | undefined;
}

export type WriteAuthoringRecordResult = RecordWriteResult;

export function authoringRecordKey(authoringId: string): string {
  return `authoring/${authoringId}`;
}

/**
 * Write one headless authoring session's record as one commit on
 * `phax/records/v1`, keyed `authoring/<authoringId>`: the brief, the prompt,
 * the retry prompt when the session was retried, the accepted document when
 * there is one, and the transcripts per `records.transcript`, plus an
 * authoring manifest whose usage counts every turn. Same destination policy,
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
      AUTHORING_TRANSCRIPT_FILES,
    );
    const usage = yield* computeSessionUsage({
      provider: input.provider,
      folder: input.sessionFolder,
      turns: [
        { transcript: RECORD_TRANSCRIPT_FILE, sessionId: input.sessionId },
        ...(input.retry === "retried"
          ? [{ transcript: RETRY_TRANSCRIPT_FILENAME, sessionId: input.retrySessionId }]
          : []),
      ],
    });

    const manifest: AuthoringRecordManifest = {
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
      retry: input.retry,
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
      manifest: encodeAuthoringRecordManifest(withSchemaUrl("authoring-record-manifest", manifest)),
      message,
      // The kept session id is decide's to resume, never the records branch's.
      redact: [input.sessionId, input.retrySessionId].filter(
        (id): id is string => id !== undefined,
      ),
    });

    return { kind: "written", commitSha, branch, key, shape, fileCount } as const;
  });
}
