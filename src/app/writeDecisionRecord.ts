import { Effect } from "effect";
import type { ArtifactKind } from "../domain/artifact/status.js";
import type { Doctrine } from "../domain/decide/doctrine.js";
import { selectRecordArtifacts } from "../domain/records/assemble.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { type Git, type GitError } from "../ports/git.js";
import { type GitHub } from "../ports/github.js";
import {
  encodeDecisionRecordManifest,
  type DecisionRecordManifest,
} from "../schemas/decisionRecord.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import type { ProviderId } from "../schemas/providerId.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  commitRecordTree,
  computeSessionUsage,
  RECORD_TRANSCRIPT_FILE,
  RECORDS_BRANCH_NAME,
  resolveRecordDestination,
  type RecordWriteResult,
} from "./recordPlumbing.js";
import type { RecordsPushResult } from "./recordsSync.js";

/**
 * Files of a decision folder, `<stateRoot>/decide/<stamp>-<slug>/<NN>/`. A
 * retried handback also holds `retry-prompt.md` and `retry-output.jsonl`.
 * `document.json` is written once an answer decodes; `before.md`, `after.md`
 * and `body.diff` once its diff is shown.
 */
export const DECIDE_PROMPT_FILENAME = "prompt.md";
export const DECIDE_HANDBACK_PROMPT_FILENAME = "handback-prompt.md";
export const DECIDE_RETRY_PROMPT_FILENAME = "retry-prompt.md";
export const DECIDE_TRANSCRIPT_FILENAME = RECORD_TRANSCRIPT_FILE;
export const DECIDE_RETRY_TRANSCRIPT_FILENAME = "retry-output.jsonl";
export const DECIDE_DOCUMENT_FILENAME = "document.json";
export const DECIDE_BEFORE_FILENAME = "before.md";
export const DECIDE_AFTER_FILENAME = "after.md";
export const DECIDE_DIFF_FILENAME = "body.diff";

/**
 * The decision-folder files a decision record may carry; anything else there
 * (`before.md`, `after.md`, the provider's `claude-session-id.txt`) is not
 * recorded.
 */
const DECISION_RECORD_FILES: readonly string[] = [
  DECIDE_PROMPT_FILENAME,
  DECIDE_HANDBACK_PROMPT_FILENAME,
  DECIDE_RETRY_PROMPT_FILENAME,
  DECIDE_DOCUMENT_FILENAME,
  DECIDE_DIFF_FILENAME,
  DECIDE_TRANSCRIPT_FILENAME,
  DECIDE_RETRY_TRANSCRIPT_FILENAME,
];

/** The handback transcripts, kept or dropped together under `records.transcript`. */
const DECISION_TRANSCRIPT_FILES: ReadonlySet<string> = new Set([
  DECIDE_TRANSCRIPT_FILENAME,
  DECIDE_RETRY_TRANSCRIPT_FILENAME,
]);

/** How the decide ended, and the commit when it landed. */
export type DecisionRecordEnd =
  | { readonly outcome: "committed"; readonly commit: string }
  | { readonly outcome: "declined" | "undecided" | "failed"; readonly commit: null };

export interface WriteDecisionRecordInput {
  /** The source repository; receives the commit for an `in-repo` destination. */
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  readonly records: ResolvedRecordsConfig;
  /** `<stateRoot>/decide/<stamp>-<slug>/<NN>/`, the decision folder. */
  readonly folder: string;
  /** `<stamp>-<slug>/<NN>`: the record key's tail and the `Decision-Id` trailer. */
  readonly decisionId: string;
  /** Repo-relative path of the artifact decided. */
  readonly artifact: string;
  readonly artifactKind: ArtifactKind;
  readonly session: "new" | "resumed-authoring";
  readonly doctrine: Doctrine["sources"];
  /** The question ids presented, in presentation order. */
  readonly questions: readonly string[];
  readonly arbitrated: number;
  readonly departed: number;
  /** HEAD when the session started. */
  readonly sourceSha: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly effort: string;
  readonly end: DecisionRecordEnd;
  /** Whether the handback was resumed once more for a refused document. */
  readonly retried: boolean;
  /**
   * Every provider session id the decide used or was told: none reaches the
   * records branch, so each is withheld from every recorded file.
   */
  readonly sessionIds: readonly string[];
}

export type WriteDecisionRecordResult = RecordWriteResult;

export function decisionRecordKey(decisionId: string): string {
  return `decision/${decisionId}`;
}

/**
 * Write one decide session's record as one commit on `phax/records/v1`, keyed
 * `decision/<decisionId>`: the prompt, the handback prompts, the accepted
 * document and the body diff when there are, and the handback transcripts per
 * `records.transcript`, plus a decision manifest whose usage counts the
 * handback turns. It carries no session id: every id the decide knew is
 * withheld from the recorded files. Same destination policy, usage extraction
 * and tree-only plumbing as an authoring record; records off is a total no-op.
 */
export function writeDecisionRecord(
  input: WriteDecisionRecordInput,
): Effect.Effect<WriteDecisionRecordResult, GitError | FsError, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    const destination = yield* resolveRecordDestination(input);
    if (destination.kind !== "write") return destination;

    const fs = yield* FileSystem;
    const listed = yield* fs.list(input.folder);
    const { shape, artifactPaths } = selectRecordArtifacts(
      listed.filter((name) => DECISION_RECORD_FILES.includes(name)),
      input.records.transcript,
      DECISION_TRANSCRIPT_FILES,
    );
    const usage = yield* computeSessionUsage({
      provider: input.provider,
      folder: input.folder,
      turns: [
        { transcript: DECIDE_TRANSCRIPT_FILENAME, sessionId: undefined },
        ...(input.retried
          ? [{ transcript: DECIDE_RETRY_TRANSCRIPT_FILENAME, sessionId: undefined }]
          : []),
      ],
    });

    const manifest: DecisionRecordManifest = {
      kind: "decision",
      decisionId: input.decisionId,
      artifact: input.artifact,
      artifactKind: input.artifactKind,
      mode: "interactive",
      session: input.session,
      doctrine: input.doctrine,
      questions: input.questions,
      arbitrated: input.arbitrated,
      departed: input.departed,
      sourceSha: input.sourceSha,
      shape,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      ...input.end,
      usage,
    };

    const key = decisionRecordKey(input.decisionId);
    const message = [
      `records(decision): ${input.end.outcome}`,
      "",
      `Decision-Id: ${input.decisionId}`,
      `Artifact: ${input.artifact}`,
      `Shape: ${shape}`,
    ].join("\n");

    const { commitSha, branch, fileCount } = yield* commitRecordTree({
      repo: destination.repo,
      folder: input.folder,
      key,
      artifactPaths,
      manifest: encodeDecisionRecordManifest(withSchemaUrl("decision-record-manifest", manifest)),
      message,
      redact: input.sessionIds,
    });

    return { kind: "written", commitSha, branch, key, shape, fileCount } as const;
  });
}

/**
 * What became of a decide session's record. A record never fails the decide:
 * an I/O failure degrades to `write-failed`, a refused destination is
 * reported, not raised.
 */
export type DecisionRecordStatus =
  | WriteDecisionRecordResult
  | { readonly kind: "write-failed"; readonly message: string };

/**
 * What became of pushing the record. `no-record`: the record was not written,
 * so there is nothing to push. A push never fails the decide.
 */
export type DecisionRecordPush = RecordsPushResult | { readonly kind: "no-record" };

/**
 * The warning a decision record outcome deserves, or undefined when there is
 * nothing to say (written, or records off). A refused destination names its
 * remedy, as authoring records do.
 */
export function decisionRecordWarning(record: DecisionRecordStatus): string | undefined {
  switch (record.kind) {
    case "written":
    case "records-off":
      return undefined;
    case "deferred-destination":
      return "decision record not written — the dedicated records clone is not configured (run `phax records sync`)";
    case "refused":
      return `decision record refused: ${record.message} (remedy: ${record.remedy})`;
    case "write-failed":
      return `failed to write the decision record (${record.message})`;
  }
}

/**
 * The warning a decision record push deserves, or undefined unless it failed.
 * A failed push leaves the record pending and names the git push that would
 * share it.
 */
export function decisionRecordPushWarning(push: DecisionRecordPush): string | undefined {
  if (push.kind !== "failed") return undefined;
  return `decision record not pushed to ${push.remote} (${push.message}) — it stays pending (\`phax records status\` lists it); share it with \`git -C ${push.path} push ${push.remote} ${RECORDS_BRANCH_NAME}\``;
}
