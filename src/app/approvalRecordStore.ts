import { Effect, Either } from "effect";
import { createHash } from "node:crypto";
import { FileSystem, type FsError } from "../ports/fs.js";
import { APPROVALS_FILE_PATH, SPEC_APPROVALS_FILE_PATH } from "../domain/artifact/lineage.js";
import { fingerprintSource } from "../domain/artifact/frontmatter.js";
import {
  decodeApprovalRecordFile,
  encodeApprovalRecordFile,
  type ApprovalRecord,
  type ApprovalRecordFile,
} from "../schemas/approvalRecord.js";
import {
  decodeSpecApprovalRecordFile,
  encodeSpecApprovalRecordFile,
  type SpecApprovalRecord,
  type SpecApprovalRecordFile,
} from "../schemas/specApprovalRecord.js";

function sortedKeys<R>(records: Record<string, R>): Record<string, R> {
  const sorted: Record<string, R> = {};
  for (const key of Object.keys(records).toSorted()) {
    sorted[key] = records[key] as R;
  }
  return sorted;
}

function readStoreFile<T>(
  filePath: string,
  decode: (u: unknown) => Either.Either<T, unknown>,
  empty: T,
): Effect.Effect<T, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(filePath))) return empty;
    const text = yield* fs.readText(filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return empty;
    }
    const decoded = decode(parsed);
    return Either.isLeft(decoded) ? empty : decoded.right;
  });
}

// ── Plan approval store ────────────────────────────────────────────────────

const EMPTY_PLAN_STORE: ApprovalRecordFile = { version: 1, records: {} };

export function readApprovalStore(): Effect.Effect<ApprovalRecordFile, FsError, FileSystem> {
  return readStoreFile(APPROVALS_FILE_PATH, decodeApprovalRecordFile, EMPTY_PLAN_STORE);
}

function writePlanApprovalStore(
  records: Record<string, ApprovalRecord>,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const file: ApprovalRecordFile = { version: 1, records: sortedKeys(records) };
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
    yield* writePlanApprovalStore({ ...store.records, [planPath]: record });
  });
}

export function removeApprovalRecord(planPath: string): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readApprovalStore();
    if (!(planPath in store.records)) return;
    const next = { ...store.records };
    delete next[planPath];
    yield* writePlanApprovalStore(next);
  });
}

// ── Spec approval store ────────────────────────────────────────────────────

const EMPTY_SPEC_STORE: SpecApprovalRecordFile = { version: 1, records: {} };

function readSpecApprovalStore(): Effect.Effect<SpecApprovalRecordFile, FsError, FileSystem> {
  return readStoreFile(SPEC_APPROVALS_FILE_PATH, decodeSpecApprovalRecordFile, EMPTY_SPEC_STORE);
}

function writeSpecApprovalStore(
  records: Record<string, SpecApprovalRecord>,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const file: SpecApprovalRecordFile = { version: 1, records: sortedKeys(records) };
    yield* fs.writeAtomic(
      SPEC_APPROVALS_FILE_PATH,
      JSON.stringify(encodeSpecApprovalRecordFile(file), null, 2),
    );
  });
}

export function readSpecApprovalRecord(
  specPath: string,
): Effect.Effect<SpecApprovalRecord | null, FsError, FileSystem> {
  return Effect.map(readSpecApprovalStore(), (store) => store.records[specPath] ?? null);
}

export function putSpecApprovalRecord(
  specPath: string,
  record: SpecApprovalRecord,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readSpecApprovalStore();
    yield* writeSpecApprovalStore({ ...store.records, [specPath]: record });
  });
}

export function removeSpecApprovalRecord(
  specPath: string,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readSpecApprovalStore();
    if (!(specPath in store.records)) return;
    const next = { ...store.records };
    delete next[specPath];
    yield* writeSpecApprovalStore(next);
  });
}

// ── Shared ─────────────────────────────────────────────────────────────────

export function artifactFingerprint(md: string): string {
  return createHash("sha256").update(fingerprintSource(md)).digest("hex");
}
