import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { readDocumentSidecar } from "../../src/schemas/persisted.js";
import { compareReleases, parseSchemaUrl } from "../../src/schemas/schemaUrl.js";
import { SURFACE_SUMMARY_PLACEHOLDER } from "../../src/schemas/specDocument.js";

// Archived specs are never migrated (surface-summary §5.11): the sidecars this
// repository archived at spec-document 0.17.0 or later must keep reading, and
// the 0.25.0 ones lift every surface element with the summary placeholder.

const ARCHIVE = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/specs/archive");

type Archived = { readonly file: string; readonly release: string; readonly json: unknown };

function archivedSpecSidecars(): readonly Archived[] {
  const archived: Archived[] = [];
  for (const entry of readdirSync(ARCHIVE)) {
    if (!entry.endsWith(".json")) continue;
    if (!existsSync(join(ARCHIVE, `${entry.slice(0, -".json".length)}.md`))) continue;
    const json: unknown = JSON.parse(readFileSync(join(ARCHIVE, entry), "utf8"));
    const stamp = parseSchemaUrl((json as { readonly $schema?: unknown }).$schema);
    if (stamp?.formatId !== "spec-document") continue;
    if (compareReleases(stamp.release, "0.17.0") < 0) continue;
    archived.push({ file: `docs/specs/archive/${entry}`, release: stamp.release, json });
  }
  return archived;
}

const ARCHIVED = archivedSpecSidecars();

describe("archived spec sidecars", () => {
  it("finds archived sidecars to read", () => {
    expect(ARCHIVED.length).toBeGreaterThan(0);
  });

  it.each(ARCHIVED.map((a) => [a.file, a] as const))("%s reads", (_file, archived) => {
    const read = readDocumentSidecar("spec", archived.file, archived.json);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    const sidecar = read.right;
    if (compareReleases(archived.release, "0.25.0") < 0) return;
    // Stamped 0.25.0 or later: read as the frozen 0.25.0 shape, or as the
    // current one when a later release stamped it so.
    if (sidecar.shape !== "0.25.0") return;
    const recorded = (archived.json as { readonly surface: ReadonlyArray<object> }).surface;
    expect(sidecar.document.surface).toEqual(
      recorded.map((element) => {
        const { surface, binding, before, after } = element as Record<string, unknown>;
        return { surface, summary: SURFACE_SUMMARY_PLACEHOLDER, binding, before, after };
      }),
    );
  });

  it("reads at least one sidecar stamped 0.25.0 as shape 0.25.0", () => {
    const shapes = ARCHIVED.map((a) => {
      const read = readDocumentSidecar("spec", a.file, a.json);
      return Either.isRight(read) ? read.right.shape : "unreadable";
    });
    expect(shapes).toContain("0.25.0");
  });
});
