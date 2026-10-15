import { Effect, Either } from "effect";
import {
  type ApprovalLedgerMigrationRequiredError,
  type ApprovalRecordUnreadableError,
  ArtifactCommitFailedError,
  ArtifactDirtyWriteSetError,
  DocumentMigrationRefusedError,
} from "../domain/errors.js";
import {
  DOCUMENT_MIGRATION_COMMIT_SUBJECT,
  type DocumentMigration,
  type DocumentMigrationRefusal,
  type DocumentMigrationResult,
  type PlanLeftStale,
  decideDocumentMigration,
  documentMigrationCommitBody,
  groupMigratedArtifacts,
} from "../domain/artifact/documentMigration.js";
import { validateArtifact } from "../domain/artifact/document.js";
import { approvalVerdict, specChangedEvidence } from "../domain/artifact/lineage.js";
import { renderDocumentMigrationRefusal } from "../domain/artifact/render.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Git, type GitError } from "../ports/git.js";
import {
  artifactFingerprint,
  readPlanApprovalRecord,
  readSpecApprovalRecord,
  refuseOldApprovalLedgers,
} from "./approvalRecordStore.js";
import { seedPlanCache } from "./planCacheStore.js";
import { scanLiveSidecars } from "./unmigratedDocuments.js";

// `phax artifact migrate-documents`: the one writer of older spec and plan
// sidecars. It never calls refuseUnmigratedDocuments — the older sidecars are
// its input — but does call refuseOldApprovalLedgers, since it reads approval
// records. Phase A decides everything without writing; phase B writes the
// sidecars and re-rendered bodies, re-seeds each rewritten plan's extraction
// cache, and commits exactly the rewritten paths in one commit. Frontmatter,
// approval record files, archived and hand-authored artifacts are never touched.

export interface MigrateDocumentsOptions {
  readonly repoRoot: string;
  /** Where the plan extraction cache lives. */
  readonly stateRoot: string;
  readonly extractPlanModel: string;
  readonly extractPlanEffort: string;
  readonly nowIso: string;
}

export type MigrateDocumentsError =
  | FsError
  | GitError
  | ApprovalRecordUnreadableError
  | ApprovalLedgerMigrationRequiredError
  | DocumentMigrationRefusedError
  | ArtifactDirtyWriteSetError
  | ArtifactCommitFailedError;

// Whether an Approved artifact's approval record no longer matches its new text.
function editedSinceApproval(
  m: DocumentMigration,
): Effect.Effect<boolean, FsError | ApprovalRecordUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    if (m.status !== "Approved") return false;
    const recorded =
      m.kind === "spec"
        ? ((yield* readSpecApprovalRecord(m.path))?.specFingerprint ?? null)
        : ((yield* readPlanApprovalRecord(m.path))?.planFingerprint ?? null);
    const verdict = approvalVerdict(recorded, artifactFingerprint(m.md));
    return verdict.kind === "recorded" && verdict.editedSinceApproval;
  });
}

// Every live Approved plan this migration leaves stale: its approval recorded
// one of the re-rendered specs at the fingerprint of its text before
// migration, which the new text no longer has (`spec-changed`), sorted by
// path. A plan already Stale, or already behind its spec, is not one.
function plansLeftStale(
  migrations: readonly DocumentMigration[],
  mdBefore: ReadonlyMap<string, string>,
): Effect.Effect<readonly PlanLeftStale[], FsError | ApprovalRecordUnreadableError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const reRendered = new Map(
      migrations
        .filter((m) => m.kind === "spec" && m.bodyChanged)
        .map((m) => {
          const before = mdBefore.get(m.path);
          return [
            m.path,
            {
              before: before === undefined ? null : artifactFingerprint(before),
              after: artifactFingerprint(m.md),
            },
          ] as const;
        }),
    );
    if (reRendered.size === 0 || !(yield* fs.exists("docs/plans"))) return [];
    const stale: PlanLeftStale[] = [];
    for (const entry of (yield* fs.list("docs/plans")).toSorted()) {
      if (!entry.endsWith(".md")) continue; // skips archive/ and approvals/
      const planPath = `docs/plans/${entry}`;
      const validated = validateArtifact(planPath, yield* fs.readText(planPath));
      if (Either.isLeft(validated) || validated.right.status !== "Approved") continue;
      const record = yield* readPlanApprovalRecord(planPath);
      const recordedSpec = record?.sourceSpec ?? null;
      if (recordedSpec === null) continue;
      const spec = reRendered.get(recordedSpec.path);
      if (spec === undefined || recordedSpec.fingerprint !== spec.before) continue;
      const evidence = specChangedEvidence(recordedSpec, spec.after);
      if (evidence !== null) stale.push({ path: planPath, specPath: evidence.specPath });
    }
    return stale;
  });
}

export function migrateDocuments(
  opts: MigrateDocumentsOptions,
): Effect.Effect<DocumentMigrationResult, MigrateDocumentsError, FileSystem | Git> {
  return Effect.gen(function* () {
    yield* refuseOldApprovalLedgers();
    const fs = yield* FileSystem;
    const git = yield* Git;

    // ── Phase A: decide everything, write nothing ──────────────────────────
    // An unreadable sidecar may be one to migrate: it is refused as invalid,
    // never passed over as already current.
    const { unmigrated, unreadable } = yield* scanLiveSidecars();
    if (unmigrated.length === 0 && unreadable.length === 0) {
      return { kind: "nothing-to-migrate" } as const;
    }

    const migrations: DocumentMigration[] = [];
    const refusals: DocumentMigrationRefusal[] = [];
    const mdBefore = new Map<string, string>();
    for (const sidecar of [...unmigrated, ...unreadable]) {
      const md = yield* fs.readText(sidecar.path);
      mdBefore.set(sidecar.path, md);
      const decision = decideDocumentMigration({
        kind: sidecar.kind,
        path: sidecar.path,
        sidecarPath: sidecar.sidecarPath,
        md,
        sidecarJson: sidecar.sidecarJson,
      });
      if (decision.kind === "refuse") refusals.push(decision.refusal);
      else migrations.push(decision.migration);
    }
    if (refusals.length > 0) {
      return yield* Effect.fail(
        new DocumentMigrationRefusedError({
          refusals,
          message: renderDocumentMigrationRefusal(refusals),
        }),
      );
    }

    const paths = migrations.flatMap((m) =>
      m.bodyChanged ? [m.path, m.sidecarPath] : [m.sidecarPath],
    );
    // An untracked sidecar is dirty too: the migration commits only committed ground.
    const dirty = yield* git.dirtyPaths(opts.repoRoot, paths);
    if (dirty.length > 0) {
      return yield* Effect.fail(new ArtifactDirtyWriteSetError({ paths: dirty }));
    }

    const entries: { migration: DocumentMigration; editedSinceApproval: boolean }[] = [];
    for (const migration of migrations) {
      entries.push({ migration, editedSinceApproval: yield* editedSinceApproval(migration) });
    }
    const stalePlans = yield* plansLeftStale(migrations, mdBefore);

    // ── Phase B: seed, write, commit ───────────────────────────────────────
    for (const m of migrations) {
      // Seeded before the plan is written, as authoring seeds: the entry is
      // content-addressed, so a seed whose plan never lands is inert.
      if (m.document.kind === "plan") {
        yield* seedPlanCache({
          stateRoot: opts.stateRoot,
          planMd: m.md,
          document: m.document.document,
          extractPlanModel: opts.extractPlanModel,
          extractPlanEffort: opts.extractPlanEffort,
          nowIso: opts.nowIso,
        });
      }
      yield* fs.writeAtomic(m.sidecarPath, m.sidecarText);
      if (m.bodyChanged) yield* fs.writeAtomic(m.path, m.md);
    }

    const subject = DOCUMENT_MIGRATION_COMMIT_SUBJECT;
    const body = documentMigrationCommitBody(migrations);
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

    return {
      kind: "migrated",
      groups: groupMigratedArtifacts(entries),
      stalePlans,
      commit: { hash, subject },
    } as const;
  });
}
