import { Effect, Either } from "effect";
import { createHash } from "node:crypto";
import { ApprovalLedgerUnreadableError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { APPROVALS_FILE_PATH, SPEC_APPROVALS_FILE_PATH } from "../domain/artifact/lineage.js";
import { fingerprintSource } from "../domain/artifact/frontmatter.js";
import {
  encodeApprovalRecordFile,
  type ApprovalRecord,
  type PlanApprovals,
} from "../schemas/approvalRecord.js";
import {
  readPlanApprovalsFile,
  readSpecApprovalsFile,
  withSchemaUrl,
  type PersistedReadError,
} from "../schemas/persisted.js";
import {
  encodeSpecApprovalRecordFile,
  type SpecApprovalRecord,
  type SpecApprovals,
} from "../schemas/specApprovalRecord.js";

function sortedKeys<R>(records: Record<string, R>): Record<string, R> {
  const sorted: Record<string, R> = {};
  for (const key of Object.keys(records).toSorted()) {
    sorted[key] = records[key] as R;
  }
  return sorted;
}

// A missing ledger is an empty one. An unreadable one — a newer release's,
// one that fails to decode, or bad JSON — is refused, never read as empty:
// every put/remove below writes back what it read, so an empty read would
// replace the whole ledger with one record.
function readStoreFile<T>(
  filePath: string,
  read: (file: string, input: unknown) => Either.Either<T, PersistedReadError>,
  empty: T,
): Effect.Effect<T, FsError | ApprovalLedgerUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    if (!(yield* fs.exists(filePath))) return empty;
    const text = yield* fs.readText(filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return yield* Effect.fail(
        new ApprovalLedgerUnreadableError({
          message: `${filePath}: not valid JSON — fix it or restore it from git`,
          ledgerPath: filePath,
        }),
      );
    }
    const decoded = read(filePath, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new ApprovalLedgerUnreadableError({ message: decoded.left.message, ledgerPath: filePath }),
      );
    }
    return decoded.right;
  });
}

// ── Plan approval store ────────────────────────────────────────────────────

const EMPTY_PLAN_STORE: PlanApprovals = { records: {} };

export function readApprovalStore(): Effect.Effect<
  PlanApprovals,
  FsError | ApprovalLedgerUnreadableError,
  FileSystem
> {
  return readStoreFile(APPROVALS_FILE_PATH, readPlanApprovalsFile, EMPTY_PLAN_STORE);
}

function writePlanApprovalStore(
  records: Record<string, ApprovalRecord>,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const ledger: PlanApprovals = { records: sortedKeys(records) };
    yield* fs.writeAtomic(
      APPROVALS_FILE_PATH,
      JSON.stringify(encodeApprovalRecordFile(withSchemaUrl("plan-approvals", ledger)), null, 2),
    );
  });
}

export function putApprovalRecord(
  planPath: string,
  record: ApprovalRecord,
): Effect.Effect<void, FsError | ApprovalLedgerUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readApprovalStore();
    yield* writePlanApprovalStore({ ...store.records, [planPath]: record });
  });
}

export function removeApprovalRecord(
  planPath: string,
): Effect.Effect<void, FsError | ApprovalLedgerUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readApprovalStore();
    if (!(planPath in store.records)) return;
    const next = { ...store.records };
    delete next[planPath];
    yield* writePlanApprovalStore(next);
  });
}

// ── Spec approval store ────────────────────────────────────────────────────

const EMPTY_SPEC_STORE: SpecApprovals = { records: {} };

function readSpecApprovalStore(): Effect.Effect<
  SpecApprovals,
  FsError | ApprovalLedgerUnreadableError,
  FileSystem
> {
  return readStoreFile(SPEC_APPROVALS_FILE_PATH, readSpecApprovalsFile, EMPTY_SPEC_STORE);
}

function writeSpecApprovalStore(
  records: Record<string, SpecApprovalRecord>,
): Effect.Effect<void, FsError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const ledger: SpecApprovals = { records: sortedKeys(records) };
    yield* fs.writeAtomic(
      SPEC_APPROVALS_FILE_PATH,
      JSON.stringify(
        encodeSpecApprovalRecordFile(withSchemaUrl("spec-approvals", ledger)),
        null,
        2,
      ),
    );
  });
}

export function readSpecApprovalRecord(
  specPath: string,
): Effect.Effect<SpecApprovalRecord | null, FsError | ApprovalLedgerUnreadableError, FileSystem> {
  return Effect.map(readSpecApprovalStore(), (store) => store.records[specPath] ?? null);
}

export function putSpecApprovalRecord(
  specPath: string,
  record: SpecApprovalRecord,
): Effect.Effect<void, FsError | ApprovalLedgerUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const store = yield* readSpecApprovalStore();
    yield* writeSpecApprovalStore({ ...store.records, [specPath]: record });
  });
}

export function removeSpecApprovalRecord(
  specPath: string,
): Effect.Effect<void, FsError | ApprovalLedgerUnreadableError, FileSystem> {
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
