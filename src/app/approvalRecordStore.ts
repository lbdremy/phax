import { Effect, Either } from "effect";
import { createHash } from "node:crypto";
import { FileSystem, type FsError } from "../ports/fs.js";
import { APPROVALS_FILE_PATH } from "../domain/artifact/lineage.js";
import { fingerprintSource } from "../domain/artifact/frontmatter.js";
import {
  decodeApprovalRecordFile,
  encodeApprovalRecordFile,
  type ApprovalRecord,
  type ApprovalRecordFile,
} from "../schemas/approvalRecord.js";

const EMPTY_STORE: ApprovalRecordFile = { version: 1, records: {} };

export function readApprovalStore(): Effect.Effect<ApprovalRecordFile, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const fileExists = yield* fs.exists(APPROVALS_FILE_PATH);
    if (!fileExists) return EMPTY_STORE;

    const text = yield* fs.readText(APPROVALS_FILE_PATH);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return EMPTY_STORE;
    }

    const decoded = decodeApprovalRecordFile(parsed);
    return Either.isLeft(decoded) ? EMPTY_STORE : decoded.right;
  });
}

function sortedRecords(records: Record<string, ApprovalRecord>): Record<string, ApprovalRecord> {
  const sorted: Record<string, ApprovalRecord> = {};
  for (const key of Object.keys(records).toSorted()) {
    sorted[key] = records[key] as ApprovalRecord;
  }
  return sorted;
}

function writeApprovalStore(
  records: Record<string, ApprovalRecord>,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const file: ApprovalRecordFile = { version: 1, records: sortedRecords(records) };
    yield* fs.writeAtomic(
      APPROVALS_FILE_PATH,
      JSON.stringify(encodeApprovalRecordFile(file), null, 2),
    );
  });
}

export function putApprovalRecord(
  planPath: string,
  record: ApprovalRecord,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readApprovalStore();
    yield* writeApprovalStore({ ...store.records, [planPath]: record });
  });
}

export function removeApprovalRecord(planPath: string): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readApprovalStore();
    if (!(planPath in store.records)) return;
    const next = { ...store.records };
    delete next[planPath];
    yield* writeApprovalStore(next);
  });
}

export function artifactFingerprint(md: string): string {
  return createHash("sha256").update(fingerprintSource(md)).digest("hex");
}
