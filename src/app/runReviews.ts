// A run's reviews, read from where phax keeps them: the entries under
// `<runId>/code-review/` and `<runId>/compliance-review/` on the records branch
// (oldest first, in branch order), then the unrecorded reviews kept in the run
// folder (`<kind>.unrecorded-<NN>.json`, oldest first), then the run folder's
// own file when it differs from the newest entry of its kind (its record write
// failed, or records were off). Local only: no fetch, no GitHub. Spec
// finding-ids-and-fates §5.1, §5.6.
import { Effect, Result } from "effect";
import { join } from "node:path";
import type { RunReview } from "../domain/findings/runFindings.js";
import { FileSystem } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import { readCodeReviewFile, readComplianceReviewFile } from "../schemas/persisted.js";
import { REVIEW_RECORD_FILES, type ReviewRecordKind } from "../schemas/reviewRecord.js";
import { RECORDS_REF } from "./recordsExplain.js";
import { gitFailureLine } from "./writeReviewRecord.js";
import type { ReviewRecordTarget, ReviewRecordUnresolved } from "./reviewEntry.js";

/** Where a run's recorded reviews are read from. */
export type RunReviewSource =
  | { readonly kind: "off" }
  | { readonly kind: "repo"; readonly path: string; readonly remoteRef: string }
  | { readonly kind: "unavailable"; readonly reason: string };

/** One review of a run, and where it was read from. */
interface ReadRunReview {
  readonly review: RunReview;
  readonly from: "records" | "run-folder";
  /** The records commit that holds it; null for a run folder file. */
  readonly recordCommit: string | null;
  /** The run folder file it was read from; null for a record. */
  readonly file: string | null;
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

/** The records branch's tip: the local branch, else the remote-tracking ref; null when neither exists. */
export function resolveRecordsTip(
  path: string,
  remoteRef: string,
): Effect.Effect<string | null, GitError, Git> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const local = yield* git.resolveRef(path, RECORDS_REF);
    return local !== null ? local : yield* git.resolveRef(path, remoteRef);
  });
}

const KINDS: readonly ReviewRecordKind[] = ["code-review", "compliance-review"];

/** The name an unrecorded review is kept under in the run folder: `<kind>.unrecorded-<NN>.json`. */
function unrecordedFileName(kind: ReviewRecordKind, n: number): string {
  return `${kind}.unrecorded-${String(n).padStart(2, "0")}.json`;
}

/** The number of a kept unrecorded review's file name, or undefined for any other name. */
function unrecordedNumber(kind: ReviewRecordKind, name: string): number | undefined {
  if (!name.startsWith(`${kind}.unrecorded-`) || !name.endsWith(".json")) return undefined;
  const digits = name.slice(`${kind}.unrecorded-`.length, -".json".length);
  return /^[0-9]+$/.test(digits) ? Number(digits) : undefined;
}

/** The unrecorded reviews of one kind kept in the run folder, oldest (lowest number) first. */
function keptUnrecordedFiles(names: readonly string[], kind: ReviewRecordKind): readonly string[] {
  return names
    .flatMap((name) => {
      const n = unrecordedNumber(kind, name);
      return n === undefined ? [] : [{ name, n }];
    })
    .toSorted((a, b) => a.n - b.n)
    .map((kept) => kept.name);
}

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
 * then each kind's unrecorded reviews kept in the run folder, oldest first, then
 * its run folder file; the reviews persisted before ids existed come before
 * those persisted with them. A run folder file is read only when its bytes differ from
 * the newest entry of its kind and from every run folder file read before it. A
 * document that cannot be read lands in `unreadable`. A git failure leaves
 * `records` unavailable and the run folder still read. Records off is no note:
 * the caller says so where it matters.
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
        const tip = yield* resolveRecordsTip(path, remoteRef);
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
          const reason = gitFailureLine(
            "stderr" in error ? (error.stderr ?? error.message) : error.message,
          );
          notes.push(`records unavailable (${reason}): reading the run folder alone`);
          return Effect.succeed([] as readonly RecordedFile[]);
        }),
      );
      for (const item of recorded) {
        newestText.set(item.kind, item.text);
        const where = `${item.sha.slice(0, 8)}:${item.path}`;
        const read = readDocument(item.kind, where, item.text);
        if (Result.isFailure(read)) unreadable.push({ where, message: read.failure });
        else {
          reviews.push({
            review: read.success,
            from: "records",
            recordCommit: item.sha,
            file: null,
          });
        }
      }
    }

    const runFolder = input.runFolder;
    if (runFolder !== null) {
      const names = yield* Effect.gen(function* () {
        if (!(yield* fs.exists(runFolder))) return [] as readonly string[];
        return yield* fs.list(runFolder);
      }).pipe(
        Effect.catch((error) => {
          unreadable.push({
            where: runFolder,
            message: `could not list ${runFolder}: ${error.message}`,
          });
          return Effect.succeed([] as readonly string[]);
        }),
      );
      for (const kind of KINDS) {
        const seen = new Set<string>();
        const newest = newestText.get(kind);
        if (newest !== undefined) seen.add(newest);
        const files = [...keptUnrecordedFiles(names, kind), REVIEW_RECORD_FILES[kind]].map((name) =>
          join(runFolder, name),
        );
        for (const file of files) {
          const text = yield* Effect.gen(function* () {
            if (!(yield* fs.exists(file))) return null;
            return yield* fs.readText(file);
          }).pipe(
            Effect.catch((error) => {
              unreadable.push({ where: file, message: `could not read ${file}: ${error.message}` });
              return Effect.succeed(null);
            }),
          );
          if (text === null || seen.has(text)) continue;
          seen.add(text);
          const read = readDocument(kind, file, text);
          if (Result.isFailure(read)) unreadable.push({ where: file, message: read.failure });
          else reviews.push({ review: read.success, from: "run-folder", recordCommit: null, file });
        }
      }
    }

    // A review persisted before ids existed is older than every review persisted
    // with them, so it comes first: a kept one, read after the records, still
    // lifts its ids after the reviews that were before it, not after newer ones.
    const ordered = [
      ...reviews.filter((r) => r.review.ids === "absent"),
      ...reviews.filter((r) => r.review.ids === "persisted"),
    ];
    return { reviews: ordered, records, notes, unreadable } satisfies RunReviewsRead;
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

/**
 * Keeps the run folder's review file of `review` under its own name,
 * `<kind>.unrecorded-<NN>.json` (NN the next free number, zero-padded), when a
 * new review is about to replace it and it is unrecorded: the records were read
 * and its bytes differ from the newest record of its kind and from every
 * review already kept (its record write failed). `readRunReviews` then reads it between the records and the run
 * folder's file, so a later review drops none of its findings (§5.6). Never
 * fails: a failure to keep it is the warning it answers.
 */
export function keepUnrecordedReview(input: {
  readonly runFolder: string;
  readonly review: ReviewRecordKind;
  readonly read: RunReviewsRead;
}): Effect.Effect<string | undefined, never, FileSystem> {
  const current = join(input.runFolder, REVIEW_RECORD_FILES[input.review]);
  if (input.read.records !== "read" || !input.read.reviews.some((r) => r.file === current)) {
    return Effect.succeed(undefined);
  }
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const text = yield* fs.readText(current);
    const taken = (yield* fs.list(input.runFolder)).flatMap((name) => {
      const n = unrecordedNumber(input.review, name);
      return n === undefined ? [] : [n];
    });
    let next = Math.max(0, ...taken) + 1;
    while (
      !(yield* fs.createExclusive(
        join(input.runFolder, unrecordedFileName(input.review, next)),
        text,
      ))
    ) {
      next += 1;
    }
    return undefined;
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        `could not keep the unrecorded ${current} before a new review replaces it (${error.message}): its findings will no longer be listed`,
      ),
    ),
  );
}
