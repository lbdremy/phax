import { Effect } from "effect";
import {
  OLD_PLAN_LEDGER_PATH,
  OLD_SPEC_LEDGER_PATH,
} from "../domain/artifact/approvalRecordFile.js";
import { describeStampedShape } from "../domain/artifact/sidecar.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import { DocumentMigrationRequiredError } from "../domain/errors.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { olderDocumentStamp } from "../schemas/persisted.js";

/** A live sidecar stamped below its document format's current shape, or written before `$schema`. */
export interface UnmigratedSidecar {
  readonly kind: ArtifactKind;
  /** The artifact beside it. */
  readonly path: string;
  readonly sidecarPath: string;
  /** A release, or `pre-schema`. */
  readonly shape: string;
  readonly sidecarJson: string;
}

const LIVE_DIRS: ReadonlyArray<{ readonly kind: ArtifactKind; readonly dir: string }> = [
  { kind: "spec", dir: "docs/specs" },
  { kind: "plan", dir: "docs/plans" },
];

const OLD_LEDGERS = new Set([OLD_PLAN_LEDGER_PATH, OLD_SPEC_LEDGER_PATH]);

/**
 * Every live sidecar — a `.json` directly under docs/specs/ or docs/plans/
 * with an `.md` of the same name beside it — whose stamp is below its
 * document format's current shape or that has no `$schema`, specs first,
 * each sorted by path. Reads the stamp only, so a refused older shape (a plan
 * at 0.19.0) is listed too; a sidecar that is not JSON is not. Archived
 * artifacts, approval record files and the old ledgers are never listed.
 */
export function findUnmigratedSidecars(): Effect.Effect<
  readonly UnmigratedSidecar[],
  FsError,
  FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const found: UnmigratedSidecar[] = [];
    for (const { kind, dir } of LIVE_DIRS) {
      if (!(yield* fs.exists(dir))) continue;
      // Sorted: the Node adapter's readdir order is not guaranteed.
      for (const entry of (yield* fs.list(dir)).toSorted()) {
        if (!entry.endsWith(".json")) continue;
        const sidecarPath = `${dir}/${entry}`;
        if (OLD_LEDGERS.has(sidecarPath)) continue;
        const path = `${sidecarPath.slice(0, -".json".length)}.md`;
        if (!(yield* fs.exists(path))) continue;
        const sidecarJson = yield* fs.readText(sidecarPath);
        let parsed: unknown;
        try {
          parsed = JSON.parse(sidecarJson);
        } catch {
          continue;
        }
        const shape = olderDocumentStamp(kind, parsed);
        if (shape !== null) found.push({ kind, path, sidecarPath, shape, sidecarJson });
      }
    }
    return found;
  });
}

/**
 * Refuses while any live sidecar is unmigrated, naming each with its stamped
 * shape and `phax artifact migrate-documents`. Approve and reopen call it
 * before anything is read for the transition or written; `gesture` names the
 * refused command ("Approval refused"). `phax artifact migrate-documents`
 * never calls it.
 */
export function refuseUnmigratedDocuments(
  gesture: string,
): Effect.Effect<void, FsError | DocumentMigrationRequiredError, FileSystem> {
  return Effect.gen(function* () {
    const unmigrated = yield* findUnmigratedSidecars();
    if (unmigrated.length === 0) return;
    return yield* Effect.fail(
      new DocumentMigrationRequiredError({
        gesture,
        sidecars: unmigrated.map((s) => ({
          sidecarPath: s.sidecarPath,
          shape: describeStampedShape(
            s.kind === "spec" ? "spec-document" : "plan-document",
            s.shape,
          ),
        })),
      }),
    );
  });
}
