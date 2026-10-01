import { Effect, Either } from "effect";
import { join } from "node:path";
import { FileSystem, type FsError } from "../ports/fs.js";
import { RegistryCorruptionError } from "../domain/errors.js";
import { readRegistryFile, withSchemaUrl } from "../schemas/persisted.js";
import { encodeRegistryFile, type Registry, type RegistryEntry } from "../schemas/registry.js";

function registryPath(stateRoot: string): string {
  return join(stateRoot, "registry.json");
}

export function readRegistry(
  stateRoot: string,
): Effect.Effect<Registry, FsError | RegistryCorruptionError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const path = registryPath(stateRoot);
    const exists = yield* fs.exists(path);
    if (!exists) {
      return { runs: [] };
    }
    const raw = yield* fs.readText(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return yield* Effect.fail(
        new RegistryCorruptionError({
          message: "Failed to parse registry.json as JSON",
          registryPath: path,
        }),
      );
    }
    const decoded = readRegistryFile(path, parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new RegistryCorruptionError({
          message: decoded.left.message,
          registryPath: path,
        }),
      );
    }
    return decoded.right;
  });
}

export function upsertRun(
  stateRoot: string,
  entry: RegistryEntry,
): Effect.Effect<void, FsError | RegistryCorruptionError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const registry = yield* readRegistry(stateRoot);
    const idx = registry.runs.findIndex(
      (r) => r.namespace === entry.namespace && r.shortName === entry.shortName,
    );
    const runs =
      idx === -1 ? [...registry.runs, entry] : registry.runs.map((r, i) => (i === idx ? entry : r));
    yield* fs.writeAtomic(
      registryPath(stateRoot),
      JSON.stringify(encodeRegistryFile(withSchemaUrl("registry", { runs })), null, 2),
    );
  });
}

export function setRunStatus(
  stateRoot: string,
  namespace: string,
  shortName: string,
  update: Partial<RegistryEntry>,
): Effect.Effect<void, FsError | RegistryCorruptionError, FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const registry = yield* readRegistry(stateRoot);
    const idx = registry.runs.findIndex(
      (r) => r.namespace === namespace && r.shortName === shortName,
    );
    if (idx === -1) return;
    const current = registry.runs[idx]!;
    const updated: RegistryEntry = {
      ...current,
      ...update,
      updatedAt: new Date().toISOString(),
    };
    const runs = registry.runs.map((r, i) => (i === idx ? updated : r));
    yield* fs.writeAtomic(
      registryPath(stateRoot),
      JSON.stringify(encodeRegistryFile(withSchemaUrl("registry", { runs })), null, 2),
    );
  });
}
