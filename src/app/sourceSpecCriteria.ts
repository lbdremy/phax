import { join } from "node:path";
import { Effect, Either } from "effect";
import { FileSystem } from "../ports/fs.js";
import { archivePathFor, isRepoSpecPath } from "../domain/artifact/document.js";
import { readPlanFrontmatter } from "../domain/artifact/lineage.js";
import { parseArtifactName } from "../domain/artifact/name.js";
import { sidecarPathFor } from "../domain/artifact/sidecar.js";
import {
  frontmatterUndecodableMessage,
  noSidecarMessage,
  notASpecPathMessage,
  sidecarUnreadableMessage,
  specNotFoundMessage,
  type NoCriterionIdsReason,
  type SpecCriteria,
} from "../domain/plan/criterionCoverage.js";
import { readDocumentSidecar } from "../schemas/persisted.js";

/** The criterion ids a plan's source spec declares, or why they are not known. */
export type SourceSpecCriteria =
  | { readonly kind: "no-source-spec" }
  | {
      /** The plan has a frontmatter block that does not decode: no `source-spec` is read from it. */
      readonly kind: "frontmatter-undecodable";
      readonly problem: string;
      readonly message: string;
    }
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
 * Reads the acceptance criteria of a spec from its JSON sidecar, in any shape,
 * lifted. A path that is not a spec path inside the repository is refused
 * before any filesystem call, so a `source-spec` of `../elsewhere/x.md` or
 * `/etc/x.md` is never read. Tries the path, then its `docs/specs/archive/`
 * path. FileSystem only.
 */
export function readSpecCriteria(opts: {
  readonly specPath: string;
  readonly repoRoot: string;
}): Effect.Effect<SpecCriteria, never, FileSystem> {
  const { specPath: declared, repoRoot } = opts;
  return Effect.gen(function* () {
    if (!isRepoSpecPath(declared)) {
      return {
        kind: "no-criterion-ids",
        spec: declared,
        reason: "not-a-spec-path",
        message: notASpecPathMessage(declared),
      } as const;
    }
    const fs = yield* FileSystem;
    const exists = (repoRel: string) =>
      fs.exists(join(repoRoot, repoRel)).pipe(Effect.orElseSucceed(() => false));

    let found: string | null = null;
    for (const candidate of new Set([declared, archivePathFor(declared)])) {
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
      criteria: read.right.document.acceptanceCriteria.map((c) => ({ id: c.id, name: c.name })),
    } as const;
  });
}

/**
 * Reads the acceptance criterion ids of a plan's source spec through
 * `readSpecCriteria`. A plan whose frontmatter block does not decode is
 * `frontmatter-undecodable`, never read as a plan without a source spec.
 */
export function readSourceSpecCriteria(opts: {
  readonly planMd: string;
  readonly repoRoot: string;
}): Effect.Effect<SourceSpecCriteria, never, FileSystem> {
  return Effect.gen(function* () {
    const frontmatter = readPlanFrontmatter(opts.planMd);
    if (frontmatter.kind === "undecodable") {
      return {
        kind: "frontmatter-undecodable",
        problem: frontmatter.problem,
        message: frontmatterUndecodableMessage(frontmatter.problem),
      } as const;
    }
    if (frontmatter.kind === "none" || frontmatter.sourceSpec.kind === "none") {
      return { kind: "no-source-spec" } as const;
    }
    const read = yield* readSpecCriteria({
      specPath: frontmatter.sourceSpec.path,
      repoRoot: opts.repoRoot,
    });
    return read.kind === "criteria"
      ? { kind: "criteria", spec: read.spec, slug: read.slug, ids: read.criteria.map((c) => c.id) }
      : read;
  });
}
