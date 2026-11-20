// A finding's fate on `phax/records/v1` (spec finding-ids-and-fates §5.10, §5.14, §5.15, §5.19).
// One fate record is one commit holding only `<runId>/finding/<id>/<NN>/record.json`; the latest
// record in branch order decides the fate. This module needs FileSystem and Git alone: a fate
// record carries no transcript, so no repository visibility is asked, nothing is pushed and no
// GitHub call is made.
import { Data, Effect, Result } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  encodeFindingFateRecordManifest,
  type FindingFateEntry,
} from "../schemas/findingFateRecord.js";
import { readFindingFateRecordManifestFile, withSchemaUrl } from "../schemas/persisted.js";
import { commitRecordTree } from "./recordPlumbing.js";
import { recordsBranchLocation } from "./recordsBranch.js";
import type { ReviewRecordTarget, ReviewRecordUnresolved } from "./reviewEntry.js";
import { resolveRecordsTip, type RunReviewSource } from "./runReviews.js";
import { gitFailureLine } from "./writeReviewRecord.js";

/** Records are off: a fate is a record, so none can be set. */
export class FindingRecordsOffError extends Data.TaggedError("FindingRecordsOffError")<{
  readonly message: string;
}> {}

/** The records cannot be reached: the project cannot be read, or its records clone is missing. */
export class FindingRecordsUnavailableError extends Data.TaggedError(
  "FindingRecordsUnavailableError",
)<{
  readonly message: string;
}> {}

/** The key of a fate record: `<runId>/finding/<id>/<NN>`, NN at least two digits. */
export function fateRecordKey(runId: string, finding: string, n: number): string {
  return `${runId}/finding/${finding}/${String(n).padStart(2, "0")}`;
}

/**
 * Where a fate record is written, or why it cannot be: records off, a project that cannot be
 * read, or a dedicated records clone that is missing. Checked before any write.
 */
export function fateRecordDestination(
  target: ReviewRecordTarget | ReviewRecordUnresolved,
): Effect.Effect<
  { readonly repo: string; readonly remote: string },
  FindingRecordsOffError | FindingRecordsUnavailableError,
  FileSystem
> {
  return Effect.gen(function* () {
    if (target.kind === "unresolved") {
      return yield* Effect.fail(new FindingRecordsUnavailableError({ message: target.reason }));
    }
    if (!target.records.enabled) {
      return yield* Effect.fail(
        new FindingRecordsOffError({
          message:
            "records are off for this project: a fate is a record on phax/records/v1, so add a records key to phax.json to set fates",
        }),
      );
    }
    const location = recordsBranchLocation(target);
    if (target.records.destination.kind === "repo") {
      const fs = yield* FileSystem;
      const clone = target.recordsClonePath;
      const present =
        clone === undefined
          ? false
          : yield* fs.exists(clone).pipe(Effect.orElseSucceed(() => false));
      if (!present) {
        return yield* Effect.fail(
          new FindingRecordsUnavailableError({
            message: `the records clone ${clone ?? "(unknown path)"} is missing: run \`phax records sync\` to clone it`,
          }),
        );
      }
    }
    return location;
  });
}

/** `<runId>/finding/<id>/<NN>/record.json` split into its id and number, or undefined. */
function parseFatePath(
  runId: string,
  path: string,
): { readonly finding: string; readonly n: number; readonly key: string } | undefined {
  const prefix = `${runId}/finding/`;
  if (!path.startsWith(prefix) || !path.endsWith("/record.json")) return undefined;
  const parts = path.slice(prefix.length, -"/record.json".length).split("/");
  const [finding, digits] = parts;
  if (parts.length !== 2 || finding === undefined || digits === undefined) return undefined;
  if (!/^[0-9]+$/.test(digits)) return undefined;
  return { finding, n: Number(digits), key: path.slice(0, -"/record.json".length) };
}

/**
 * Writes one fate record as one commit on `phax/records/v1`: keyed one more than the highest
 * number the branch history holds for the finding. The tip is the local branch, else the
 * remote-tracking ref. Never pushes.
 */
export function writeFateRecord(input: {
  readonly destination: { readonly repo: string; readonly remote: string };
  readonly runId: string;
  readonly finding: string;
  readonly entry: FindingFateEntry;
}): Effect.Effect<
  { readonly key: string; readonly recordCommit: string },
  GitError | FsError,
  FileSystem | Git
> {
  return Effect.gen(function* () {
    const git = yield* Git;
    const { repo, remote } = input.destination;
    const tip = yield* resolveRecordsTip(repo, `refs/remotes/${remote}/phax/records/v1`);
    let highest = 0;
    if (tip !== null) {
      for (const commit of yield* git.listCommitFiles(repo, tip, null)) {
        for (const path of commit.paths) {
          const parsed = parseFatePath(input.runId, path);
          if (parsed !== undefined && parsed.finding === input.finding) {
            highest = Math.max(highest, parsed.n);
          }
        }
      }
    }
    const key = fateRecordKey(input.runId, input.finding, highest + 1);
    const manifest = encodeFindingFateRecordManifest(
      withSchemaUrl("finding-fate-record-manifest", {
        kind: "finding-fate" as const,
        runId: input.runId,
        finding: input.finding,
        ...input.entry,
      }) as Parameters<typeof encodeFindingFateRecordManifest>[0],
    );
    const written = yield* commitRecordTree({
      repo,
      remote,
      folder: repo,
      key,
      artifactPaths: [],
      manifest,
      message: [
        `records(finding): ${input.finding} ${input.entry.fate}`,
        "",
        `Run-Id: ${input.runId}`,
        `Finding: ${input.finding}`,
        `Fate: ${input.entry.fate}`,
      ].join("\n"),
    });
    return { key, recordCommit: written.commitSha };
  });
}

/** One fate record of a run, as read. */
interface ReadFateRecord {
  readonly finding: string;
  readonly key: string;
  readonly recordCommit: string;
  readonly entry: FindingFateEntry;
}

export interface RunFateRecordsRead {
  /** Oldest first, in branch order. */
  readonly records: readonly ReadFateRecord[];
  /** Each record that cannot be read, with its path on the records branch and its commit. */
  readonly unreadable: readonly UnreadableFateRecord[];
  readonly notes: readonly string[];
}

interface UnreadableFateRecord {
  /** `<sha8>:<path>`, as the reader's message names it. */
  readonly where: string;
  readonly message: string;
  /** The record's `record.json` path on the records branch. */
  readonly path: string;
  readonly recordCommit: string;
}

const NO_RECORDS: RunFateRecordsRead = { records: [], unreadable: [], notes: [] };

function entryOf(manifest: {
  readonly kind: string;
  readonly runId: string;
  readonly finding: string;
}): FindingFateEntry {
  const { kind: _kind, runId: _runId, finding: _finding, ...entry } = manifest;
  return entry as FindingFateEntry;
}

/**
 * A run's fate records, oldest first in branch order. A source that is off or unavailable
 * answers none; a git failure answers none and a note. A record that cannot be read, or whose
 * `runId` or `finding` disagrees with its key, lands in `unreadable`.
 */
export function readRunFateRecords(input: {
  readonly runId: string;
  readonly source: RunReviewSource;
}): Effect.Effect<RunFateRecordsRead, never, FileSystem | Git> {
  return Effect.gen(function* () {
    if (input.source.kind !== "repo") return NO_RECORDS;
    const { path, remoteRef } = input.source;
    const fs = yield* FileSystem;
    const git = yield* Git;
    if (!(yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false)))) return NO_RECORDS;
    const records: ReadFateRecord[] = [];
    const unreadable: UnreadableFateRecord[] = [];
    const walked = yield* Effect.gen(function* () {
      const tip = yield* resolveRecordsTip(path, remoteRef);
      if (tip === null) return;
      for (const commit of yield* git.listCommitFiles(path, tip, null)) {
        const hits = commit.paths.flatMap((p) => {
          const parsed = parseFatePath(input.runId, p);
          return parsed === undefined ? [] : [{ path: p, ...parsed }];
        });
        if (hits.length === 0) continue;
        const entries = yield* git.readTree(path, commit.sha);
        for (const hit of hits) {
          const blob = entries.find((e) => e.type === "blob" && e.path === hit.path);
          if (blob === undefined) continue;
          const text = new TextDecoder().decode(yield* git.readBlob(path, blob.oid));
          const where = `${commit.sha.slice(0, 8)}:${hit.path}`;
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(text);
          } catch (error) {
            unreadable.push({
              where,
              message: `${where} is not JSON (${String(error)})`,
              path: hit.path,
              recordCommit: commit.sha,
            });
            continue;
          }
          const read = readFindingFateRecordManifestFile(where, parsedJson);
          if (Result.isFailure(read)) {
            unreadable.push({
              where,
              message: read.failure.message,
              path: hit.path,
              recordCommit: commit.sha,
            });
            continue;
          }
          const manifest = read.success;
          if (manifest.runId !== input.runId || manifest.finding !== hit.finding) {
            unreadable.push({
              where,
              message: `${where} names ${manifest.runId}/${manifest.finding}, not the finding its key names`,
              path: hit.path,
              recordCommit: commit.sha,
            });
            continue;
          }
          records.push({
            finding: hit.finding,
            key: hit.key,
            recordCommit: commit.sha,
            entry: entryOf(manifest),
          });
        }
      }
    }).pipe(
      Effect.map(() => undefined),
      Effect.catch((error) =>
        Effect.succeed(
          `fate records unavailable (${gitFailureLine("stderr" in error ? (error.stderr ?? error.message) : error.message)})`,
        ),
      ),
    );
    return {
      records: walked === undefined ? records : [],
      unreadable: walked === undefined ? unreadable : [],
      notes: walked === undefined ? [] : [walked],
    };
  });
}
