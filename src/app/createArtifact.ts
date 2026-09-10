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

export interface CreateArtifactInput {
  readonly kind: ArtifactKind;
  readonly slug: string;
  readonly sourceSpec: string | null;
  readonly nowIso: string;
  readonly repoRoot: string;
}

export interface CreateArtifactResult {
  readonly path: string;
  readonly sourceSpec: string | null;
}

function specSkeleton(nowIso: string): string {
  const date = nowIso.split("T")[0] ?? nowIso;
  return `---
status: Draft
date: ${date}
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
`;
}

function planSkeleton(sourceSpec: string | null): string {
  return `---
status: Draft
source-spec: ${sourceSpec ?? "null"}
---
`;
}

// Validates and resolves the --spec argument for `artifact new plan`: it must
// classify as a spec (live or archived), exist, and pass validateArtifact —
// the same checks a plan approval later relies on when reading its source spec.
function resolveSourceSpec(
  sourceSpecPath: string,
): Effect.Effect<string, ArtifactCreationError | FsError, FileSystem> {
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

    return sourceSpecPath;
  });
}

// Creates a `Draft` spec or plan skeleton named from the current UTC minute
// and the given slug. Every refusal (bad slug, existing target, missing or
// invalid source spec) fails before anything is written.
export function createArtifact(
  input: CreateArtifactInput,
): Effect.Effect<CreateArtifactResult, ArtifactCreationError | FsError, FileSystem> {
  return Effect.gen(function* () {
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

    const content = input.kind === "spec" ? specSkeleton(input.nowIso) : planSkeleton(sourceSpec);
    yield* fs.mkdirp(dir);
    yield* fs.writeAtomic(path, content);

    return { path, sourceSpec };
  });
}
