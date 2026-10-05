import { Effect, Either } from "effect";
import {
  ApprovalMigrationRefusedError,
  ApprovalRecordUnreadableError,
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
} from "../domain/errors.js";
import {
  OLD_PLAN_LEDGER_PATH,
  OLD_SPEC_LEDGER_PATH,
  approvalRecordDirFor,
  approvalRecordPathFor,
  type ApprovalMigrationResult,
  type MigratedApprovalLedger,
  type OrphanApprovalRecord,
} from "../domain/artifact/approvalRecordFile.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  readPlanApprovalsFile,
  readSpecApprovalsFile,
  type PersistedReadError,
} from "../schemas/persisted.js";
import {
  readPlanApprovalRecord,
  readSpecApprovalRecord,
  renderPlanRecordFile,
  renderSpecRecordFile,
} from "./approvalRecordStore.js";

// `phax artifact migrate-approvals`: the one reader of the old ledgers. It
// never calls refuseOldApprovalLedgers — the ledgers are its input. Phase A
// decides everything without writing; phase B writes the record files,
// deletes the ledgers and commits exactly those paths in one commit.

export const MIGRATION_COMMIT_SUBJECT =
  "chore(approvals): migrate approval ledgers to record files";

export interface MigrateApprovalsOptions {
  readonly repoRoot: string;
}

export type MigrateApprovalsError =
  | FsError
  | GitError
  | ApprovalRecordUnreadableError
  | ApprovalMigrationRefusedError
  | ArtifactDirtyWriteSetError
  | ArtifactCommitFailedError;

type ReadExisting = (
  artifact: string,
) => Effect.Effect<string | null, FsError | ApprovalRecordUnreadableError, FileSystem>;

// One old ledger's kind: how to decode it into rendered record files, and how
// to render an existing target record file the same way, so "holds the same
// record" is a comparison of canonical bytes.
interface LedgerKind {
  readonly kind: ArtifactKind;
  readonly ledgerPath: string;
  readonly decode: (
    file: string,
    input: unknown,
  ) => Either.Either<ReadonlyArray<readonly [string, string]>, PersistedReadError>;
  readonly readExisting: ReadExisting;
}

const LEDGER_KINDS: readonly LedgerKind[] = [
  {
    kind: "plan",
    ledgerPath: OLD_PLAN_LEDGER_PATH,
    decode: (file, input) =>
      Either.map(readPlanApprovalsFile(file, input), (ledger) =>
        Object.entries(ledger.records).map(
          ([artifact, record]) =>
            [artifact, renderPlanRecordFile({ artifact, ...record })] as const,
        ),
      ),
    readExisting: (artifact) =>
      Effect.map(readPlanApprovalRecord(artifact), (r) =>
        r === null ? null : renderPlanRecordFile(r),
      ),
  },
  {
    kind: "spec",
    ledgerPath: OLD_SPEC_LEDGER_PATH,
    decode: (file, input) =>
      Either.map(readSpecApprovalsFile(file, input), (ledger) =>
        Object.entries(ledger.records).map(
          ([artifact, record]) =>
            [artifact, renderSpecRecordFile({ artifact, ...record })] as const,
        ),
      ),
    readExisting: (artifact) =>
      Effect.map(readSpecApprovalRecord(artifact), (r) =>
        r === null ? null : renderSpecRecordFile(r),
      ),
  },
];

interface PlannedRecord {
  readonly artifact: string;
  readonly recordFile: string;
  readonly content: string;
  /** The target already holds this record: kept as is, never rewritten. */
  readonly keep: boolean;
}

interface PlannedLedger {
  readonly kind: ArtifactKind;
  readonly ledgerPath: string;
  readonly records: readonly PlannedRecord[];
}

function unreadableLedger(ledgerPath: string, message: string): ApprovalRecordUnreadableError {
  return new ApprovalRecordUnreadableError({ message, recordPath: ledgerPath });
}

// Phase A for one ledger: decode it and check every entry, writing nothing.
function planLedger(
  spec: LedgerKind,
): Effect.Effect<
  PlannedLedger,
  FsError | ApprovalRecordUnreadableError | ApprovalMigrationRefusedError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const { kind, ledgerPath } = spec;
    const text = yield* fs.readText(ledgerPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return yield* Effect.fail(
        unreadableLedger(
          ledgerPath,
          `${ledgerPath}: not valid JSON — fix it or restore it from git`,
        ),
      );
    }
    const decoded = spec.decode(ledgerPath, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(unreadableLedger(ledgerPath, decoded.left.message));
    }

    const records: PlannedRecord[] = [];
    for (const [artifact, content] of decoded.right.toSorted(([a], [b]) => (a < b ? -1 : 1))) {
      // Null exactly when the key is not a live artifact path of the ledger's kind.
      const recordFile = approvalRecordPathFor(kind, artifact);
      if (recordFile === null) {
        return yield* Effect.fail(
          new ApprovalMigrationRefusedError({
            message: `${ledgerPath}: entry ${artifact} is not a live ${kind} path — remove the entry, then rerun`,
            path: ledgerPath,
          }),
        );
      }
      const existing = yield* spec.readExisting(artifact).pipe(
        Effect.catchTag("ApprovalRecordUnreadableError", () =>
          Effect.fail(
            new ApprovalMigrationRefusedError({
              message: `${ledgerPath}: entry ${artifact} cannot migrate — ${recordFile} already exists and is unreadable; delete it or restore it from git, then rerun`,
              path: recordFile,
            }),
          ),
        ),
      );
      if (existing !== null && existing !== content) {
        return yield* Effect.fail(
          new ApprovalMigrationRefusedError({
            message: `${ledgerPath}: entry ${artifact} cannot migrate — ${recordFile} already holds a different record; delete it or make it match the entry, then rerun`,
            path: recordFile,
          }),
        );
      }
      records.push({ artifact, recordFile, content, keep: existing !== null });
    }
    return { kind, ledgerPath, records };
  });
}

function recordFileCount(n: number): string {
  return `${n} record file${n === 1 ? "" : "s"}`;
}

function migrationCommitBody(ledgers: readonly PlannedLedger[]): string {
  const counts = ledgers.map((l) => `- ${l.ledgerPath} → ${recordFileCount(l.records.length)}`);
  return [
    "Split the old approval ledgers into one record file per artifact, and delete the ledgers.",
    "",
    ...counts,
  ].join("\n");
}

export function migrateApprovals(
  opts: MigrateApprovalsOptions,
): Effect.Effect<ApprovalMigrationResult, MigrateApprovalsError, FileSystem | Git> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const git = yield* Git;

    // ── Phase A: decide everything, write nothing ──────────────────────────
    const present: LedgerKind[] = [];
    for (const spec of LEDGER_KINDS) {
      if (yield* fs.exists(spec.ledgerPath)) present.push(spec);
    }
    if (present.length === 0) return { kind: "nothing-to-migrate" } as const;

    const ledgers: PlannedLedger[] = [];
    for (const spec of present) ledgers.push(yield* planLedger(spec));

    const paths = [
      ...ledgers.map((l) => l.ledgerPath),
      ...ledgers.flatMap((l) => l.records.map((r) => r.recordFile)),
    ];
    // An untracked ledger is dirty too: the migration commits only committed ground.
    const dirty = yield* git.dirtyPaths(opts.repoRoot, paths);
    if (dirty.length > 0) {
      return yield* Effect.fail(new ArtifactDirtyWriteSetError({ paths: dirty }));
    }

    const orphans: OrphanApprovalRecord[] = [];
    for (const ledger of ledgers) {
      for (const r of ledger.records) {
        if (!(yield* fs.exists(r.artifact))) {
          orphans.push({ recordFile: r.recordFile, artifact: r.artifact });
        }
      }
    }

    // ── Phase B: write, delete, commit ─────────────────────────────────────
    for (const ledger of ledgers) {
      const toWrite = ledger.records.filter((r) => !r.keep);
      if (toWrite.length > 0) yield* fs.mkdirp(approvalRecordDirFor(ledger.kind).slice(0, -1));
      for (const r of toWrite) yield* fs.writeAtomic(r.recordFile, r.content);
      yield* fs.remove(ledger.ledgerPath);
    }

    const subject = MIGRATION_COMMIT_SUBJECT;
    const body = migrationCommitBody(ledgers);
    const committed = yield* Effect.either(git.commitPaths(opts.repoRoot, paths, subject, body));
    if (Either.isLeft(committed)) {
      return yield* Effect.fail(
        new ArtifactCommitFailedError({
          paths,
          cause: committed.left.message,
          commitMessage: { subject, body },
        }),
      );
    }
    const hash = yield* git.headCommit(opts.repoRoot);

    const migrated: MigratedApprovalLedger[] = ledgers.map((l) => ({
      ledgerPath: l.ledgerPath,
      recordFiles: l.records.map((r) => r.recordFile),
    }));
    return {
      kind: "migrated",
      ledgers: migrated,
      orphans: orphans.toSorted((a, b) => (a.recordFile < b.recordFile ? -1 : 1)),
      commit: { hash, subject },
    } as const;
  });
}
