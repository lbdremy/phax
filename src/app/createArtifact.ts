import { Effect, Either } from "effect";
import { FileSystem, type FsError } from "../ports/fs.js";
import { ArtifactCreationError } from "../domain/errors.js";
import type { ArtifactKind } from "../domain/artifact/status.js";
import {
  artifactNameGrammar,
  buildArtifactName,
  isSlug,
  parseArtifactName,
} from "../domain/artifact/name.js";
import { classifyArtifactPath, validateArtifact } from "../domain/artifact/document.js";
import { resolveCompletesSpec } from "../domain/artifact/lineage.js";

/** The raw `--last` / `--not-last` flags of `artifact new plan`. */
export interface CompletionFlags {
  readonly last: boolean;
  readonly notLast: boolean;
}

export interface CreateArtifactInput {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly sourceSpec: string | null;
  readonly completion: CompletionFlags;
  readonly nowIso: string;
  readonly repoRoot: string;
}

export interface CreateArtifactResult {
  readonly path: string;
  readonly sourceSpec: string | null;
  /** The plan's `completes-spec`, or null without a source spec (always null for a spec). */
  readonly completesSpec: boolean | null;
}

export interface ArtifactTargetInput {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly sourceSpec: string | null;
  readonly completion: CompletionFlags;
  readonly nowIso: string;
}

/** A validated source spec: its repo-relative path and its Markdown. */
export interface ResolvedSourceSpec {
  readonly path: string;
  readonly markdown: string;
}

export interface ArtifactTarget {
  /** Repo-relative directory the artifact lands in (`docs/specs` or `docs/plans`). */
  readonly dir: string;
  /** Repo-relative path of the artifact to create. */
  readonly path: string;
  /** A plan's validated source spec, or null (always null for a spec). */
  readonly sourceSpec: ResolvedSourceSpec | null;
  /** A plan's `completes-spec` from `--last`/`--not-last`; null without a source spec. */
  readonly completesSpec: boolean | null;
}

/** A plan's lineage as its frontmatter states it: the source spec and whether it completes it. */
export interface PlanLineage {
  readonly path: string;
  readonly completesSpec: boolean;
}

export function specSkeleton(nowIso: string): string {
  const date = nowIso.split("T")[0] ?? nowIso;
  return `---
status: Draft
date: ${date}
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
`;
}

// `completes-spec` sits right after `source-spec`, and only when a spec is bound.
export function planSkeleton(lineage: PlanLineage | null): string {
  const lineageLines =
    lineage === null
      ? "source-spec: null"
      : `source-spec: ${lineage.path}\ncompletes-spec: ${String(lineage.completesSpec)}`;
  return `---
status: Draft
${lineageLines}
---
`;
}

/** The lineage a plan target's frontmatter states, or null for a spec-less plan. */
export function targetLineage(target: ArtifactTarget): PlanLineage | null {
  return target.sourceSpec === null || target.completesSpec === null
    ? null
    : { path: target.sourceSpec.path, completesSpec: target.completesSpec };
}

// Validates and resolves the --spec argument for `artifact new plan`: it must
// classify as a spec (live or archived), exist, and pass validateArtifact —
// the same checks a plan approval later relies on when reading its source spec.
function resolveSourceSpec(
  sourceSpecPath: string,
): Effect.Effect<ResolvedSourceSpec, ArtifactCreationError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const classification = classifyArtifactPath(sourceSpecPath);
    if (classification === null || classification.kind !== "spec") {
      return yield* Effect.fail(
        new ArtifactCreationError({
          message: `--spec ${sourceSpecPath} is not a spec path`,
        }),
      );
    }

    const fs = yield* FileSystem;
    const exists = yield* fs.exists(sourceSpecPath);
    if (!exists) {
      return yield* Effect.fail(
        new ArtifactCreationError({ message: `--spec ${sourceSpecPath} does not exist` }),
      );
    }

    const specMd = yield* fs.readText(sourceSpecPath);
    const validated = validateArtifact(sourceSpecPath, specMd);
    if (Either.isLeft(validated)) {
      return yield* Effect.fail(
        new ArtifactCreationError({
          message: `--spec ${sourceSpecPath} is not a valid spec: ${validated.left.message}`,
        }),
      );
    }

    return { path: sourceSpecPath, markdown: specMd };
  });
}

// The refusals shared by the interactive and headless `artifact new` paths —
// a plan's `--spec` without exactly one of `--last`/`--not-last` (or either flag
// without `--spec`), bad slug, off-grammar name, existing target, missing or
// invalid source spec — resolved without writing anything.
export function resolveArtifactTarget(
  input: ArtifactTargetInput,
): Effect.Effect<ArtifactTarget, ArtifactCreationError | FsError, FileSystem> {
  return Effect.gen(function* () {
    // A spec ignores the flags: the CLI never offers them on `new spec`.
    let completesSpec: boolean | null = null;
    if (input.kind === "plan") {
      const resolved = resolveCompletesSpec({
        hasSourceSpec: input.sourceSpec !== null,
        last: input.completion.last,
        notLast: input.completion.notLast,
      });
      if (Either.isLeft(resolved)) {
        return yield* Effect.fail(new ArtifactCreationError({ message: resolved.left }));
      }
      completesSpec = resolved.right;
    }

    if (!isSlug(input.slug)) {
      return yield* Effect.fail(
        new ArtifactCreationError({
          message: `slug "${input.slug}" does not match [a-z0-9]+(-[a-z0-9]+)*`,
        }),
      );
    }

    const name = buildArtifactName(input.kind, input.nowIso, input.slug);
    // A grammatical slug can still build an off-grammar name: a spec slug ending
    // in "-plan" reads as a plan, which every artifact command then refuses.
    if (parseArtifactName(input.kind, name) === null) {
      return yield* Effect.fail(
        new ArtifactCreationError({
          message: `slug "${input.slug}" would name ${name}, which does not match ${artifactNameGrammar(input.kind)}`,
        }),
      );
    }
    const dir = input.kind === "spec" ? "docs/specs" : "docs/plans";
    const path = `${dir}/${name}`;

    const fs = yield* FileSystem;
    const targetExists = yield* fs.exists(path);
    if (targetExists) {
      return yield* Effect.fail(new ArtifactCreationError({ message: `${path} already exists` }));
    }

    const sourceSpec =
      input.kind === "plan" && input.sourceSpec !== null
        ? yield* resolveSourceSpec(input.sourceSpec)
        : null;

    return { dir, path, sourceSpec, completesSpec };
  });
}

// Creates a `Draft` spec or plan skeleton named from the current UTC minute
// and the given slug. Every refusal (bad slug, bad `--last`/`--not-last`
// pairing, existing target, missing or invalid source spec) fails before
// anything is written.
export function createArtifact(
  input: CreateArtifactInput,
): Effect.Effect<CreateArtifactResult, ArtifactCreationError | FsError, FileSystem> {
  return Effect.gen(function* () {
    const target = yield* resolveArtifactTarget(input);

    const content =
      input.kind === "spec" ? specSkeleton(input.nowIso) : planSkeleton(targetLineage(target));
    const fs = yield* FileSystem;
    yield* fs.mkdirp(target.dir);
    yield* fs.writeAtomic(target.path, content);

    return {
      path: target.path,
      sourceSpec: target.sourceSpec?.path ?? null,
      completesSpec: target.completesSpec,
    };
  });
}
