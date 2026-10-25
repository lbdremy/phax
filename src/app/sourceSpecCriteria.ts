import { join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem } from "../ports/fs.js";
import { archivePathFor } from "../domain/artifact/document.js";
import { readSourceSpec } from "../domain/artifact/lineage.js";
import { parseArtifactName } from "../domain/artifact/name.js";
import { sidecarPathFor } from "../domain/artifact/sidecar.js";
import {
  noSidecarMessage,
  sidecarUnreadableMessage,
  specNotFoundMessage,
  type NoCriterionIdsReason,
} from "../domain/plan/criterionCoverage.js";
import { readDocumentSidecar } from "../schemas/persisted.js";

/** The criterion ids a plan's source spec declares, or why they are not known. */
export type SourceSpecCriteria =
  | { readonly kind: "no-source-spec" }
  | {
      readonly kind: "criteria";
      /** The spec path that was read, repo-relative. */
      readonly spec: string;
      readonly slug: string;
      /** In spec order. */
      readonly ids: readonly string[];
    }
  | {
      readonly kind: "no-criterion-ids";
      readonly spec: string;
      readonly reason: NoCriterionIdsReason;
      readonly message: string;
    };

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * Reads the acceptance criterion ids of a plan's source spec from its JSON
 * sidecar, in any shape. Tries the declared path, then its `docs/specs/archive/`
 * path. FileSystem only.
 */
export function readSourceSpecCriteria(opts: {
  readonly planMd: string;
  readonly repoRoot: string;
}): Effect.Effect<SourceSpecCriteria, never, FileSystem> {
  const { planMd, repoRoot } = opts;
  return Effect.gen(function* () {
    const declaration = readSourceSpec(planMd);
    if (declaration === null || declaration.kind === "none") {
      return { kind: "no-source-spec" } as const;
    }
    const fs = yield* FileSystem;
    const declared = declaration.path;
    let candidates: readonly string[];
    try {
      candidates = [declared, archivePathFor(declared)];
    } catch {
      candidates = [declared];
    }
    const exists = (repoRel: string) =>
      fs.exists(join(repoRoot, repoRel)).pipe(Effect.orElseSucceed(() => false));

    let found: string | null = null;
    for (const candidate of candidates) {
      if (yield* exists(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found === null) {
      return {
        kind: "no-criterion-ids",
        spec: declared,
        reason: "not-found",
        message: specNotFoundMessage(declared),
      } as const;
    }
    const spec = found;
    const sidecar = sidecarPathFor(spec);
    if (!(yield* exists(sidecar))) {
      return {
        kind: "no-criterion-ids",
        spec,
        reason: "no-sidecar",
        message: noSidecarMessage(spec),
      } as const;
    }
    const unreadable = (reason: string) =>
      ({
        kind: "no-criterion-ids",
        spec,
        reason: "unreadable",
        message: sidecarUnreadableMessage(sidecar, reason),
      }) as const;
    const text = yield* fs.readText(join(repoRoot, sidecar)).pipe(Effect.either);
    if (Either.isLeft(text)) return unreadable(text.left.message);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.right);
    } catch (e) {
      return unreadable(e instanceof Error ? e.message : String(e));
    }
    const read = readDocumentSidecar("spec", sidecar, parsed);
    if (Either.isLeft(read)) return unreadable(read.left.message);
    return {
      kind: "criteria",
      spec,
      slug: parseArtifactName("spec", fileNameOf(spec))?.slug ?? spec,
      ids: read.right.document.acceptanceCriteria.map((c) => c.id),
    } as const;
  });
}
