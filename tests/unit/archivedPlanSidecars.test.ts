import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { readDocumentSidecar } from "../../src/schemas/persisted.js";
import { compareReleases, parseSchemaUrl } from "../../src/schemas/schemaUrl.js";

// The repository's own archived plans are the corpus: every plan sidecar
// stamped plan-document 0.20.0 or later must still read, lifted in memory and
// never rewritten. A sidecar stamped below 0.20.0 lacks `completesSpec` and
// stays refused, so it is not read here. Compared by the stamp each file names,
// never by the running version, so the corpus does not shift at a release.

const ARCHIVE = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "docs",
  "plans",
  "archive",
);

interface Archived {
  readonly name: string;
  readonly release: string;
  readonly json: Record<string, unknown>;
}

function archivedSidecars(): readonly Archived[] {
  const found: Archived[] = [];
  for (const entry of readdirSync(ARCHIVE)) {
    if (!entry.endsWith(".json")) continue;
    if (!existsSync(join(ARCHIVE, `${entry.slice(0, -".json".length)}.md`))) continue;
    const json: unknown = JSON.parse(readFileSync(join(ARCHIVE, entry), "utf8"));
    if (typeof json !== "object" || json === null) continue;
    const record = json as Record<string, unknown>;
    const named = parseSchemaUrl(record["$schema"]);
    if (named === undefined || named.formatId !== "plan-document") continue;
    if (compareReleases(named.release, "0.20.0") < 0) continue;
    found.push({ name: entry, release: named.release, json: record });
  }
  return found;
}

describe("archived plan sidecars", () => {
  const sidecars = archivedSidecars();

  it("finds sidecars stamped 0.20.0 and sidecars stamped 0.25.0", () => {
    expect(sidecars.length).toBeGreaterThan(0);
    expect(sidecars.some((s) => s.release === "0.25.0")).toBe(true);
  });

  it.each(sidecars.map((s) => [s.name, s] as const))("%s reads", (_name, archived) => {
    const read = readDocumentSidecar("plan", archived.name, archived.json);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    expect(read.right.kind).toBe("plan");
  });

  it("reads each 0.25.0 sidecar as shape 0.25.0, every modelReason carried over as assignmentReason", () => {
    for (const archived of sidecars.filter((s) => s.release === "0.25.0")) {
      const read = readDocumentSidecar("plan", archived.name, archived.json);
      if (Either.isLeft(read)) throw new Error(read.left.message);
      expect(read.right.shape, archived.name).toBe("0.25.0");
      const recorded = (archived.json["phases"] as Array<Record<string, unknown>>).map(
        (phase) => phase["modelReason"],
      );
      expect(
        read.right.document.phases.map((phase) => phase.assignmentReason),
        archived.name,
      ).toEqual(recorded);
    }
  });
});
