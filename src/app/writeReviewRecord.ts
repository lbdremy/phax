import { Effect } from "effect";
import { FileSystem } from "../ports/fs.js";
import { type Git } from "../ports/git.js";
import { type GitHub } from "../ports/github.js";
import { withSchemaUrl } from "../schemas/persisted.js";
import type { ResolvedRecordsConfig } from "../schemas/recordsConfig.js";
import {
  encodeReviewRecordManifest,
  REVIEW_RECORD_FILES,
  type ReviewRecordKind,
} from "../schemas/reviewRecord.js";
import {
  commitRecordTree,
  RECORDS_BRANCH_NAME,
  resolveRecordDestination,
  type RecordSkipped,
} from "./recordPlumbing.js";
import type { RecordsPushResult } from "./recordsSync.js";

export interface WriteReviewRecordInput {
  /** The source repository; receives the commit for an `in-repo` destination. */
  readonly repoRoot: string;
  /** The local records clone, required for a dedicated `repo` destination. */
  readonly recordsClonePath?: string | undefined;
  readonly records: ResolvedRecordsConfig;
  readonly runId: string;
  /** The run folder, which holds the review's file. */
  readonly runPath: string;
  readonly review: ReviewRecordKind;
}

/**
 * What became of a review entry. A review entry never fails its review: an I/O
 * failure (a missing review file included) degrades to `write-failed`, a
 * refused or deferred destination is reported, not raised.
 */
export type ReviewRecordStatus =
  | {
      readonly kind: "written";
      readonly commitSha: string;
      readonly branch: string;
      readonly key: string;
      readonly fileCount: number;
    }
  | RecordSkipped
  | { readonly kind: "write-failed"; readonly message: string };

/**
 * What became of pushing the entry. `no-record`: no entry was written, so
 * there is nothing to push. `left-to-publish`: the entry was written and
 * publish's records push carries it, as at run end. A push never fails the
 * review.
 */
export type ReviewRecordPush =
  | RecordsPushResult
  | { readonly kind: "no-record" }
  | { readonly kind: "left-to-publish" };

/** The entry's key: `<runId>/<review>`, beside the run's `<runId>/phase-NN` records. */
export function reviewRecordKey(runId: string, review: ReviewRecordKind): string {
  return `${runId}/${review}`;
}

/**
 * Write one run-level review file as one commit on `phax/records/v1`, keyed
 * `<runId>/<review>`: the review's file, byte for byte, and a review manifest.
 * Same destination policy and tree-only plumbing as every record; records off
 * is a total no-op. Never fails: the error channel is `never`.
 */
export function writeReviewRecord(
  input: WriteReviewRecordInput,
): Effect.Effect<ReviewRecordStatus, never, Git | FileSystem | GitHub> {
  return Effect.gen(function* () {
    const destination = yield* resolveRecordDestination(input);
    if (destination.kind !== "write") return destination;
    // A dedicated clone that does not exist yet is deferred, not failed: no
    // run preflight guards a by-hand review, and `phax records sync` makes it.
    if (input.records.destination.kind === "repo") {
      const fs = yield* FileSystem;
      if (!(yield* fs.exists(destination.repo))) {
        return { kind: "deferred-destination", destination: "repo" } as const;
      }
    }

    const key = reviewRecordKey(input.runId, input.review);
    const message = [
      `records(review): ${input.review}`,
      "",
      `Run-Id: ${input.runId}`,
      `Review: ${input.review}`,
    ].join("\n");

    const { commitSha, branch, fileCount } = yield* commitRecordTree({
      repo: destination.repo,
      folder: input.runPath,
      key,
      artifactPaths: [REVIEW_RECORD_FILES[input.review]],
      manifest: encodeReviewRecordManifest(
        withSchemaUrl("review-record-manifest", {
          kind: "review",
          runId: input.runId,
          review: input.review,
        }),
      ),
      message,
    });

    return { kind: "written", commitSha, branch, key, fileCount } as const;
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        kind: "write-failed",
        message: gitFailureLine(
          "stderr" in error ? (error.stderr ?? error.message) : error.message,
        ),
      } as const),
    ),
  );
}

/**
 * The one line of a git failure worth showing: the first non-empty line,
 * skipping git's `To <remote>` push preamble. git's stderr can run to several
 * localized lines; a warning carries one.
 */
export function gitFailureLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.find((line) => !line.startsWith("To ")) ?? lines[0] ?? text.trim();
}

/**
 * The warning a review entry's outcome deserves, or undefined when there is
 * nothing to say (written, or records off). A failed commit leaves the
 * review's file in the run folder; `phax records status` reads git alone, so it
 * cannot list an entry that was never committed — the remedy is a rerun, the
 * caller's `retryCommand` (the review's own command with the run's name).
 */
export function reviewRecordWarning(
  status: ReviewRecordStatus,
  review: ReviewRecordKind,
  retryCommand: string,
): string | undefined {
  switch (status.kind) {
    case "written":
    case "records-off":
      return undefined;
    case "deferred-destination":
      return `${review} entry not written — the dedicated records clone is missing: run \`phax records sync\`, then \`${retryCommand}\` to record a new review`;
    case "refused":
      return `${review} entry refused: ${status.message} (remedy: ${status.remedy})`;
    case "write-failed":
      return `the ${review} entry was not committed to ${RECORDS_BRANCH_NAME} (${status.message}) — it is pending: ${REVIEW_RECORD_FILES[review]} stays in the run folder; rerun \`${retryCommand}\` to record a new review`;
  }
}

/**
 * The warning a review entry's push deserves, or undefined unless it failed.
 * A failed push leaves the entry pending (the commit exists locally, so
 * `phax records status` lists it) and names the git push that would share it.
 */
export function reviewRecordPushWarning(push: ReviewRecordPush): string | undefined {
  if (push.kind !== "failed") return undefined;
  return `review entry not pushed to ${push.remote} (${gitFailureLine(push.message)}) — it stays pending (\`phax records status\` lists it); share it with \`git -C ${push.path} push ${push.remote} ${RECORDS_BRANCH_NAME}\``;
}
