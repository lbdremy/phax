import { Effect } from "effect";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { selectRecordArtifacts } from "../domain/records/assemble.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { type Git, type GitError } from "../ports/git.js";
import { type GitHub } from "../ports/github.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  encodeRevisionRecordManifest,
  type RevisionFailure,
  type RevisionRecordManifest,
} from "../schemas/revisionRecord.js";
import {
  commitRecordTree,
  computeSessionUsage,
  RECORD_TRANSCRIPT_FILE,
  resolveRecordDestination,
  type RecordWriteResult,
} from "./recordPlumbing.js";
import { describeRecordsPushFailure } from "./recordsBranch.js";
import type { RecordsPushResult } from "./recordsSync.js";

/**
 * Files of a revision folder. A retried writer also holds `retry-prompt.md`
 * and `retry-output.jsonl`. `document.json` is written once an answer decodes;
 * `before.md`, `after.md` and `body.diff` once its diff is computed.
 */
export const REVISE_AMENDMENT_FILENAME = "amendment.md";
export const REVISE_PROMPT_FILENAME = "prompt.md";
export const REVISE_RETRY_PROMPT_FILENAME = "retry-prompt.md";
export const REVISE_TRANSCRIPT_FILENAME = RECORD_TRANSCRIPT_FILE;
export const REVISE_RETRY_TRANSCRIPT_FILENAME = "retry-output.jsonl";
export const REVISE_DOCUMENT_FILENAME = "document.json";
export const REVISE_BEFORE_FILENAME = "before.md";
export const REVISE_AFTER_FILENAME = "after.md";
export const REVISE_DIFF_FILENAME = "body.diff";

/** The revision-folder files a revision record may carry; before/after are never recorded. */
const REVISION_RECORD_FILES: readonly string[] = [
  REVISE_AMENDMENT_FILENAME,
  REVISE_PROMPT_FILENAME,
  REVISE_RETRY_PROMPT_FILENAME,
  REVISE_DOCUMENT_FILENAME,
  REVISE_DIFF_FILENAME,
  REVISE_TRANSCRIPT_FILENAME,
  REVISE_RETRY_TRANSCRIPT_FILENAME,
];

/** The writer transcripts, kept or dropped together under `records.transcript`. */
const REVISION_TRANSCRIPT_FILES: ReadonlySet<string> = new Set([
  REVISE_TRANSCRIPT_FILENAME,
  REVISE_RETRY_TRANSCRIPT_FILENAME,
]);

/** How a revise that ran a writer session ended, and the commit when it landed. */
export type RevisionRecordEnd =
  | { readonly outcome: "committed"; readonly commit: string }
  | { readonly outcome: "unchanged"; readonly commit: null }
  | { readonly outcome: "failed"; readonly commit: null; readonly failure: RevisionFailure };

export interface WriteRevisionRecordInput {
  /** The source repository; receives the commit for an `in-repo` destination. */
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  readonly records: ResolvedRecordsConfig;
  /** The remote an in-repo destination publishes to (`publish.remote`). */
  readonly publishRemote: string;
  /** The revision folder. */
  readonly folder: string;
  /** `<authoringId>/<NN>`: the record key's tail and the `Revision-Id` trailer. */
  readonly revisionId: string;
  /** Repo-relative path of the artifact revised. */
  readonly artifact: string;
  readonly artifactKind: ArtifactKind;
  readonly session: "new" | "resumed-authoring";
  readonly requester:
    | { readonly kind: "operator"; readonly name: string }
    | { readonly kind: "machine"; readonly grant: string };
  /** The ids of the open questions the revision appended. */
  readonly newQuestions: readonly string[];
  /** HEAD when the session started. */
  readonly sourceSha: string;
  readonly provider: ProviderId;
  /** The concrete model the session ran. */
  readonly model: string;
  /** The model asked for, by flag or configuration. */
  readonly requestedModel: string;
  readonly effort: string;
  readonly end: RevisionRecordEnd;
  /** Whether the writer was resumed once more for a refused document. */
  readonly retried: boolean;
  /** The session id of the first turn and, when retried, of the retry. */
  readonly turnSessionIds: readonly string[];
  /**
   * Every provider session id the revise used or was told: none reaches the
   * records branch, so each is withheld from every recorded file.
   */
  readonly sessionIds: readonly string[];
}

export type WriteRevisionRecordResult = RecordWriteResult;

export function revisionRecordKey(revisionId: string): string {
  return `revision/${revisionId}`;
}

/**
 * Write one revise writer session's record as one commit on `phax/records/v1`,
 * keyed `revision/<revisionId>`: the amendment, the prompts, the accepted
 * document and the body diff when there are, and the transcripts per
 * `records.transcript`, plus a revision manifest whose usage counts the
 * writer's turns. No session id reaches it. Records off is a total no-op.
 */
export function writeRevisionRecord(
  input: WriteRevisionRecordInput,
): Effect.Effect<WriteRevisionRecordResult, GitError | FsError, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    const destination = yield* resolveRecordDestination(input);
    if (destination.kind !== "write") return destination;

    const fs = yield* FileSystem;
    const listed = yield* fs.list(input.folder);
    const { shape, artifactPaths } = selectRecordArtifacts(
      listed.filter((name) => REVISION_RECORD_FILES.includes(name)),
      input.records.transcript,
      REVISION_TRANSCRIPT_FILES,
    );
    const usage = yield* computeSessionUsage({
      provider: input.provider,
      folder: input.folder,
      turns: [
        { transcript: REVISE_TRANSCRIPT_FILENAME, sessionId: input.turnSessionIds[0] },
        ...(input.retried
          ? [{ transcript: REVISE_RETRY_TRANSCRIPT_FILENAME, sessionId: input.turnSessionIds[1] }]
          : []),
      ],
    });

    const manifest: RevisionRecordManifest = {
      kind: "revision",
      revisionId: input.revisionId,
      artifact: input.artifact,
      artifactKind: input.artifactKind,
      session: input.session,
      requester: input.requester,
      newQuestions: input.newQuestions,
      sourceSha: input.sourceSha,
      shape,
      provider: input.provider,
      model: input.model,
      requestedModel: input.requestedModel,
      effort: input.effort,
      usage,
      ...input.end,
    };

    const key = revisionRecordKey(input.revisionId);
    const message = [
      `records(revision): ${input.end.outcome}`,
      "",
      `Revision-Id: ${input.revisionId}`,
      `Artifact: ${input.artifact}`,
      `Shape: ${shape}`,
    ].join("\n");

    const { commitSha, branch, fileCount, branchState, branchNote } = yield* commitRecordTree({
      repo: destination.repo,
      remote: destination.remote,
      folder: input.folder,
      key,
      artifactPaths,
      manifest: encodeRevisionRecordManifest(withSchemaUrl("revision-record-manifest", manifest)),
      message,
      redact: input.sessionIds,
    });

    return {
      kind: "written",
      commitSha,
      branch,
      key,
      shape,
      fileCount,
      branchState,
      branchNote,
    } as const;
  });
}

/**
 * What became of a revise session's record. A record never fails the revise:
 * an I/O failure degrades to `write-failed`, a refused destination is
 * reported, not raised.
 */
export type RevisionRecordStatus =
  | WriteRevisionRecordResult
  | { readonly kind: "write-failed"; readonly message: string };

/** What became of pushing the record; `no-record`: nothing was written to push. */
export type RevisionRecordPush = RecordsPushResult | { readonly kind: "no-record" };

/** The warning a revision record outcome deserves, or undefined when there is nothing to say. */
export function revisionRecordWarning(
  record: RevisionRecordStatus,
  followingFailedSession = false,
): string | undefined {
  switch (record.kind) {
    case "written":
      return record.branchNote === null ? undefined : `revision ${record.branchNote}`;
    case "records-off":
      return undefined;
    case "deferred-destination":
      return "revision record not written — the dedicated records clone is not configured (run `phax records sync`)";
    case "refused":
      return `revision record refused${followingFailedSession ? ", following the failed session" : ""}: ${record.message} (remedy: ${record.remedy})`;
    case "write-failed":
      return `failed to write the revision record (${record.message})`;
  }
}

/** The warning a revision record push deserves, or undefined unless it failed. */
export function revisionRecordPushWarning(push: RevisionRecordPush): string | undefined {
  if (push.kind !== "failed") return undefined;
  return describeRecordsPushFailure(push, "revision record");
}
