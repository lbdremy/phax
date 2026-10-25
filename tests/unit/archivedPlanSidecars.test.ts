import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { readDocumentSidecar } from "../../src/schemas/persisted.js";
import { compareReleases, parseSchemaUrl } from "../../src/schemas/schemaUrl.js";

// The repository's own archived plans are the corpus: every plan sidecar
// stamped plan-document 0.20.0 or later must still read, lifted in memory and
// never rewritten; a lift its prose test strategy refuses is still a read. A sidecar stamped below 0.20.0 lacks `completesSpec` and
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

  // A sidecar below the current shape reads whatever its test strategies hold:
  // its lift is the document, or refused at a phase of the file and a line.
  it.each(sidecars.map((s) => [s.name, s] as const))("%s reads", (_name, archived) => {
    const read = readDocumentSidecar("plan", archived.name, archived.json);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    const sidecar = read.right;
    expect(sidecar.kind).toBe("plan");
    if (sidecar.shape === "current" || sidecar.lift.kind === "lifted") return;
    const phaseIds = (archived.json["phases"] as Array<Record<string, unknown>>).map(
      (phase) => phase["id"],
    );
    expect(phaseIds).toContain(sidecar.lift.phase);
    expect(sidecar.lift.departure.line).toBeGreaterThanOrEqual(1);
  });

  it("refuses the lift of every 0.25.0 sidecar, whose test strategies are prose", () => {
    const older = sidecars.filter((s) => s.release === "0.25.0");
    expect(older.length).toBeGreaterThan(0);
    for (const archived of older) {
      const read = readDocumentSidecar("plan", archived.name, archived.json);
      if (Either.isLeft(read)) throw new Error(read.left.message);
      expect(read.right.shape, archived.name).toBe("0.25.0");
      expect(read.right.shape !== "current" && read.right.lift.kind, archived.name).toBe("refused");
    }
  });

  it("lifts the 0.26.0 surface-summary sidecar, whose test strategies follow the line format", () => {
    const archived = sidecars.find((s) => s.name === "2610241631-surface-summary-plan.json");
    if (archived === undefined) throw new Error("the surface-summary sidecar is archived");
    const read = readDocumentSidecar("plan", archived.name, archived.json);
    if (Either.isLeft(read)) throw new Error(read.left.message);
    expect(read.right.shape).toBe("0.26.0");
    const lift = read.right.shape === "current" ? null : read.right.lift;
    expect(lift?.kind).toBe("lifted");
    if (lift?.kind !== "lifted") return;
    expect(lift.document.phases.every((phase) => phase.testStrategy.length > 0)).toBe(true);
  });
});
