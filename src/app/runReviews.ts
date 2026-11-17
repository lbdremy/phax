// A run's reviews, read from where phax keeps them: the entries under
// `<runId>/code-review/` and `<runId>/compliance-review/` on the records branch
// (oldest first, in branch order), then the run folder's own file when it
// differs from the newest entry of its kind (its record write failed, or records
// were off). Local only: no fetch, no GitHub. Spec finding-ids-and-fates §5.1.
import { Effect, Result } from "effect";
import { join } from "node:path";
import type { RunReview } from "../domain/findings/runFindings.js";
import { FileSystem } from "../ports/fs.js";
import { Git } from "../ports/git.js";
import { readCodeReviewFile, readComplianceReviewFile } from "../schemas/persisted.js";
import { REVIEW_RECORD_FILES, type ReviewRecordKind } from "../schemas/reviewRecord.js";
import { RECORDS_REF } from "./recordsExplain.js";
import type { ReviewRecordTarget, ReviewRecordUnresolved } from "./reviewEntry.js";

/** Where a run's recorded reviews are read from. */
export type RunReviewSource =
  | { readonly kind: "off" }
  | { readonly kind: "repo"; readonly path: string; readonly remoteRef: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/** One review of a run, and where it was read from. */
export interface ReadRunReview {
  readonly review: RunReview;
  readonly from: "records" | "run-folder";
  /** The records commit that holds it; null for the run folder's file. */
  readonly recordCommit: string | null;
}

export interface RunReviewsRead {
  readonly reviews: readonly ReadRunReview[];
  readonly records: "read" | "off" | "unavailable";
  readonly notes: readonly string[];
  readonly unreadable: readonly { readonly where: string; readonly message: string }[];
}

/** The source a review's target names: its records repository, or why there is none. */
export function reviewSourceOf(
  target: ReviewRecordTarget | ReviewRecordUnresolved,
): RunReviewSource {
  if (target.kind === "unresolved") return { kind: "unavailable", reason: target.reason };
  if (!target.records.enabled) return { kind: "off" };
  if (target.records.destination.kind === "in-repo") {
    return {
      kind: "repo",
      path: target.repoRoot,
      remoteRef: `refs/remotes/${target.publishRemote}/phax/records/v1`,
    };
  }
  if (target.recordsClonePath === undefined) {
    return { kind: "unavailable", reason: "the records clone path is not known" };
  }
  return {
    kind: "repo",
    path: target.recordsClonePath,
    remoteRef: "refs/remotes/origin/phax/records/v1",
  };
}

const KINDS: readonly ReviewRecordKind[] = ["code-review", "compliance-review"];

/** Parse and read one review document; a failure is a message, never a throw. */
function readDocument(
  kind: ReviewRecordKind,
  label: string,
  text: string,
): Result.Result<RunReview, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return Result.fail(`${label} is not JSON (${String(error)})`);
  }
  if (kind === "code-review") {
    const read = readCodeReviewFile(label, parsed);
    if (Result.isFailure(read)) return Result.fail(read.failure.message);
    return read.success.shape === "current"
      ? Result.succeed({ source: kind, ids: "persisted", review: read.success.review })
      : Result.succeed({ source: kind, ids: "absent", review: read.success.review });
  }
  const read = readComplianceReviewFile(label, parsed);
  if (Result.isFailure(read)) return Result.fail(read.failure.message);
  return read.success.shape === "current"
    ? Result.succeed({ source: kind, ids: "persisted", review: read.success.review })
    : Result.succeed({ source: kind, ids: "absent", review: read.success.review });
}

interface RecordedFile {
  readonly kind: ReviewRecordKind;
  readonly sha: string;
  readonly path: string;
  readonly text: string;
}

/**
 * A run's reviews, oldest first: the records branch's entries in branch order,
 * then each kind's run folder file when its bytes differ from the newest entry
 * of that kind. A document that cannot be read lands in `unreadable`. A git
 * failure leaves `records` unavailable and the run folder still read.
 */
export function readRunReviews(input: {
  readonly runId: string;
  readonly runFolder: string | null;
  readonly source: RunReviewSource;
}): Effect.Effect<RunReviewsRead, never, FileSystem | Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const fs = yield* FileSystem;
    const reviews: ReadRunReview[] = [];
    const notes: string[] = [];
    const unreadable: { where: string; message: string }[] = [];
    const newestText = new Map<ReviewRecordKind, string>();
    let records: RunReviewsRead["records"] = "read";

    if (input.source.kind === "off") {
      records = "off";
      notes.push("records are off: reading the run folder alone");
    } else if (input.source.kind === "unavailable") {
      records = "unavailable";
      notes.push(`records unavailable (${input.source.reason}): reading the run folder alone`);
    } else {
      const { path, remoteRef } = input.source;
      const keys = new Map<string, ReviewRecordKind>(
        KINDS.map((kind) => [`${input.runId}/${kind}/${REVIEW_RECORD_FILES[kind]}`, kind]),
      );
      const recorded: readonly RecordedFile[] = yield* Effect.gen(function* () {
        if (!(yield* fs.exists(path))) {
          records = "unavailable";
          notes.push(
            `records unavailable (the records clone ${path} is missing): reading the run folder alone`,
          );
          return [] as readonly RecordedFile[];
        }
        let tip = yield* git.resolveRef(path, RECORDS_REF);
        if (tip === null) tip = yield* git.resolveRef(path, remoteRef);
        if (tip === null) return [] as readonly RecordedFile[];
        const found: RecordedFile[] = [];
        for (const commit of yield* git.listCommitFiles(path, tip, null)) {
          const hits = commit.paths.filter((p) => keys.has(p));
          if (hits.length === 0) continue;
          const entries = yield* git.readTree(path, commit.sha);
          for (const hit of hits) {
            const kind = keys.get(hit);
            const entry = entries.find((e) => e.type === "blob" && e.path === hit);
            if (kind === undefined || entry === undefined) continue;
            const bytes = yield* git.readBlob(path, entry.oid);
            found.push({ kind, sha: commit.sha, path: hit, text: new TextDecoder().decode(bytes) });
          }
        }
        return found;
      }).pipe(
        Effect.catch((error) => {
          records = "unavailable";
          notes.push(`records unavailable (${error.message}): reading the run folder alone`);
          return Effect.succeed([] as readonly RecordedFile[]);
        }),
      );
      for (const item of recorded) {
        newestText.set(item.kind, item.text);
        const where = `${item.sha.slice(0, 8)}:${item.path}`;
        const read = readDocument(item.kind, where, item.text);
        if (Result.isFailure(read)) unreadable.push({ where, message: read.failure });
        else reviews.push({ review: read.success, from: "records", recordCommit: item.sha });
      }
    }

    if (input.runFolder !== null) {
      for (const kind of KINDS) {
        const file = join(input.runFolder, REVIEW_RECORD_FILES[kind]);
        const text = yield* Effect.gen(function* () {
          if (!(yield* fs.exists(file))) return null;
          return yield* fs.readText(file);
        }).pipe(
          Effect.catch((error) => {
            unreadable.push({ where: file, message: `could not read ${file}: ${error.message}` });
            return Effect.succeed(null);
          }),
        );
        if (text === null || text === newestText.get(kind)) continue;
        const read = readDocument(kind, file, text);
        if (Result.isFailure(read)) unreadable.push({ where: file, message: read.failure });
        else reviews.push({ review: read.success, from: "run-folder", recordCommit: null });
      }
    }

    return { reviews, records, notes, unreadable } satisfies RunReviewsRead;
  });
}

/**
 * The warnings a read deserves when a new review is numbered after it: each
 * note, and each unreadable document with the fact that numbering continues
 * after the readable reviews.
 */
export function runReviewWarnings(read: RunReviewsRead): readonly string[] {
  return [
    ...read.notes,
    ...read.unreadable.map(
      (u) => `${u.message}; numbering continues after the run's readable reviews`,
    ),
  ];
}
