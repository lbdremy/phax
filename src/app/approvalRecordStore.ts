import { Effect, Either } from "effect";
import { createHash } from "node:crypto";
import { ApprovalRecordUnreadableError, ArtifactValidationError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import {
  approvalRecordDirFor,
  approvalRecordPathFor,
  artifactPathForRecordFile,
  type OrphanApprovalRecord,
} from "../domain/artifact/approvalRecordFile.js";
import { fingerprintSource } from "../domain/artifact/frontmatter.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import {
  encodePlanRecordFile,
  type ApprovalRecord,
  type PlanRecord,
} from "../schemas/approvalRecord.js";
import {
  readPlanRecordFile,
  readSpecRecordFile,
  withSchemaUrl,
  type PersistedReadError,
} from "../schemas/persisted.js";
import {
  encodeSpecRecordFile,
  type SpecApprovalRecord,
  type SpecRecord,
} from "../schemas/specApprovalRecord.js";

// Each artifact's approval record is its own file, located from the artifact
// path alone (approvalRecordPathFor). No operation reads or writes another
// artifact's record file, so transitions of different artifacts never touch
// the same path.

type RecordReader<R> = (file: string, input: unknown) => Either.Either<R, PersistedReadError>;

// A missing file is no record, and so is a path that is not a live artifact
// (no disk access). An unreadable file — not JSON, failing to decode, without
// `$schema`, from a newer release, or naming another artifact — is refused,
// never read as no record.
function readRecordFile<R extends { readonly artifact: string }>(
  kind: ArtifactKind,
  artifactPath: string,
  read: RecordReader<R>,
): Effect.Effect<R | null, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const recordPath = approvalRecordPathFor(kind, artifactPath);
    if (recordPath === null) return null;
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(recordPath))) return null;
    const text = yield* fs.readText(recordPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return yield* Effect.fail(
        new ApprovalRecordUnreadableError({
          message: `${recordPath}: not valid JSON — fix it or restore it from git`,
          recordPath,
        }),
      );
    }
    const decoded = read(recordPath, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new ApprovalRecordUnreadableError({ message: decoded.left.message, recordPath }),
      );
    }
    if (decoded.right.artifact !== artifactPath) {
      return yield* Effect.fail(
        new ApprovalRecordUnreadableError({
          message: `${recordPath}: records ${decoded.right.artifact}, not ${artifactPath} — restore it from git, or delete it and re-approve`,
          recordPath,
        }),
      );
    }
    return decoded.right;
  });
}

// Only a live artifact carries a record. validateArtifact accepts a plan or
// spec nested below docs/plans/ or docs/specs/, which has no record path, so
// approving one is refused here, before anything is written.
function liveRecordPath(
  kind: ArtifactKind,
  artifactPath: string,
): Effect.Effect<string, ArtifactValidationError> {
  const recordPath = approvalRecordPathFor(kind, artifactPath);
  if (recordPath !== null) return Effect.succeed(recordPath);
  return Effect.fail(
    new ArtifactValidationError({
      path: artifactPath,
      message: `${artifactPath} is not directly under docs/${kind}s/ — only a live ${kind} carries an approval record`,
    }),
  );
}

// Reads first, so an unreadable existing file is refused and left byte-identical.
function putRecordFile<R extends { readonly artifact: string }>(
  kind: ArtifactKind,
  artifactPath: string,
  read: RecordReader<R>,
  render: () => string,
): Effect.Effect<
  void,
  FsError | ApprovalRecordUnreadableError | ArtifactValidationError,
  FileSystem
> {
  return Effect.gen(function* () {
    const recordPath = yield* liveRecordPath(kind, artifactPath);
    yield* readRecordFile(kind, artifactPath, read);
    const fs = yield* FileSystem;
    yield* fs.mkdirp(recordPath.slice(0, recordPath.lastIndexOf("/")));
    yield* fs.writeAtomic(recordPath, render());
  });
}

function removeRecordFile<R extends { readonly artifact: string }>(
  kind: ArtifactKind,
  artifactPath: string,
  read: RecordReader<R>,
): Effect.Effect<void, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const recordPath = approvalRecordPathFor(kind, artifactPath);
    if (recordPath === null) return;
    // Reads first, so an unreadable file is refused rather than deleted.
    if ((yield* readRecordFile(kind, artifactPath, read)) === null) return;
    const fs = yield* FileSystem;
    yield* fs.remove(recordPath);
  });
}

function recordFileExists(
  kind: ArtifactKind,
  artifactPath: string,
): Effect.Effect<boolean, FsError, FileSystem> {
  return Effect.gen(function* () {
    const recordPath = approvalRecordPathFor(kind, artifactPath);
    if (recordPath === null) return false;
    const fs = yield* FileSystem;
    return yield* fs.exists(recordPath);
  });
}

// ── Plan approval records ──────────────────────────────────────────────────

export function readPlanApprovalRecord(
  planPath: string,
): Effect.Effect<PlanRecord | null, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return readRecordFile("plan", planPath, readPlanRecordFile);
}

export function putPlanApprovalRecord(
  planPath: string,
  record: ApprovalRecord,
): Effect.Effect<
  void,
  FsError | ApprovalRecordUnreadableError | ArtifactValidationError,
  FileSystem
> {
  return putRecordFile("plan", planPath, readPlanRecordFile, () =>
    JSON.stringify(
      encodePlanRecordFile(
        withSchemaUrl("plan-approval-record", { artifact: planPath, ...record }),
      ),
      null,
      2,
    ),
  );
}

export function removePlanApprovalRecord(
  planPath: string,
): Effect.Effect<void, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return removeRecordFile("plan", planPath, readPlanRecordFile);
}

export function planApprovalRecordExists(
  planPath: string,
): Effect.Effect<boolean, FsError, FileSystem> {
  return recordFileExists("plan", planPath);
}

// ── Spec approval records ──────────────────────────────────────────────────

export function readSpecApprovalRecord(
  specPath: string,
): Effect.Effect<SpecRecord | null, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return readRecordFile("spec", specPath, readSpecRecordFile);
}

export function putSpecApprovalRecord(
  specPath: string,
  record: SpecApprovalRecord,
): Effect.Effect<
  void,
  FsError | ApprovalRecordUnreadableError | ArtifactValidationError,
  FileSystem
> {
  return putRecordFile("spec", specPath, readSpecRecordFile, () =>
    JSON.stringify(
      encodeSpecRecordFile(
        withSchemaUrl("spec-approval-record", { artifact: specPath, ...record }),
      ),
      null,
      2,
    ),
  );
}

export function removeSpecApprovalRecord(
  specPath: string,
): Effect.Effect<void, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return removeRecordFile("spec", specPath, readSpecRecordFile);
}

export function specApprovalRecordExists(
  specPath: string,
): Effect.Effect<boolean, FsError, FileSystem> {
  return recordFileExists("spec", specPath);
}

// ── Orphans ────────────────────────────────────────────────────────────────

/**
 * The record files of `kind` whose artifact does not exist, sorted by record
 * file. Contents are never read, so an unreadable orphan is still only an
 * orphan; entries that are not record files (wrong extension, directories)
 * are ignored.
 */
export function findOrphanApprovalRecords(
  kind: ArtifactKind,
): Effect.Effect<readonly OrphanApprovalRecord[], FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const dir = approvalRecordDirFor(kind);
    const dirPath = dir.slice(0, -1);
    if (!(yield* fs.exists(dirPath))) return [];
    const orphans: OrphanApprovalRecord[] = [];
    // Sorted: the Node adapter's readdir order is not guaranteed.
    for (const entry of (yield* fs.list(dirPath)).toSorted()) {
      const recordFile = `${dir}${entry}`;
      const owner = artifactPathForRecordFile(recordFile);
      if (owner === null || owner.kind !== kind) continue;
      if (yield* fs.exists(owner.artifact)) continue;
      orphans.push({ recordFile, artifact: owner.artifact });
    }
    return orphans;
  });
}

// ── Shared ─────────────────────────────────────────────────────────────────

export function artifactFingerprint(md: string): string {
  return createHash("sha256").update(fingerprintSource(md)).digest("hex");
}
