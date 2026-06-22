import { Either } from "effect";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "../schemas/phaxConfig.js";
import { parseRunRef, runKey } from "../domain/runRef.js";
import { resolveRun } from "./resolveRunInfo.js";
import { decodeRegistry, type Registry } from "../schemas/registry.js";
import type { RunReviewInfo } from "../domain/runReviewInfo.js";
import type { ShortName } from "../domain/branded.js";

export type ResolveRunRefVariant =
  | "ambiguous-outside-project"
  | "not-found"
  | "unresolvable-qualified";

export interface ResolveRunRefRefusal {
  readonly variant: ResolveRunRefVariant;
  readonly message: string;
  readonly candidates?: readonly string[];
}

export interface ResolveRunRefResult {
  readonly namespace: string;
  readonly shortName: string;
  readonly info: RunReviewInfo;
  /** True when the resolved namespace differs from the current project's namespace. */
  readonly crossProject: boolean;
}

function readRegistrySync(stateRoot: string): Registry | undefined {
  const path = join(stateRoot, "registry.json");
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const decoded = decodeRegistry(raw);
    return Either.isRight(decoded) ? decoded.right : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a raw user run-reference argument to a located run.
 *
 * Rules:
 * - Unqualified + inside a project: resolve against the current namespace, reject if the
 *   found run belongs to a different namespace.
 * - Unqualified + outside a project: refuse with matching qualified candidates from the registry.
 * - Qualified: resolve the exact (namespace, shortName) via the registry, then load from disk.
 *   Refuses with `unresolvable-qualified` when the registry entry exists but files are unreadable.
 */
export function resolveRunRef(
  rawArg: string,
  config: ResolvedConfig | undefined,
  stateRoot: string,
): Either.Either<ResolveRunRefResult, ResolveRunRefRefusal> {
  const parseResult = parseRunRef(rawArg);
  if (Either.isLeft(parseResult)) {
    return Either.left({ variant: "not-found", message: parseResult.left });
  }

  const ref = parseResult.right;

  if (ref.namespace === undefined) {
    // Unqualified short name
    if (config === undefined) {
      // Outside a project: list candidates from registry
      const registry = readRegistrySync(stateRoot);
      const candidates = (registry?.runs ?? [])
        .filter((r) => r.shortName === ref.shortName)
        .map((r) => runKey(r.namespace, r.shortName));
      const message =
        candidates.length > 0
          ? `Run "${ref.shortName}" is ambiguous outside a project. Matching runs: ${candidates.join(", ")}. Use the qualified name.`
          : `Run "${ref.shortName}" not found. No PHAX project is active. Use a qualified name like <namespace>.${ref.shortName}.`;
      return Either.left({ variant: "ambiguous-outside-project", message, candidates });
    }

    // Inside a project: resolve against current namespace
    const namespace = config.namespace;
    const infoResult = resolveRun(namespace, ref.shortName as ShortName, stateRoot);
    if (Either.isLeft(infoResult)) {
      return Either.left({
        variant: "not-found",
        message: `Run "${runKey(namespace, ref.shortName)}" not found.`,
      });
    }

    const info = infoResult.right;
    if (info.namespace !== namespace) {
      return Either.left({
        variant: "not-found",
        message: `Run "${ref.shortName}" not found in namespace "${namespace}".`,
      });
    }

    return Either.right({ namespace, shortName: ref.shortName, info, crossProject: false });
  }

  // Qualified: resolve exact (namespace, shortName)
  const namespace = ref.namespace;
  const shortName = ref.shortName;

  const registry = readRegistrySync(stateRoot);
  const entry = (registry?.runs ?? []).find(
    (r) => r.namespace === namespace && r.shortName === shortName,
  );

  if (entry === undefined) {
    return Either.left({
      variant: "not-found",
      message: `Run "${runKey(namespace, shortName)}" not found.`,
    });
  }

  const infoResult = resolveRun(namespace, shortName as ShortName, stateRoot);
  if (Either.isLeft(infoResult)) {
    return Either.left({
      variant: "unresolvable-qualified",
      message: `Run "${runKey(namespace, shortName)}" is in the registry but its files could not be read. Run from the owning repository, or the run may have been cleared.`,
    });
  }

  const crossProject = config !== undefined && config.namespace !== namespace;
  return Either.right({ namespace, shortName, info: infoResult.right, crossProject });
}
