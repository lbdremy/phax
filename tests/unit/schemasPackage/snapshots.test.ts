import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { WRITE_COMMAND } from "../../../packages/schemas/build/generated.js";
import {
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../../../packages/schemas/build/jsonSchemas.js";
import {
  SNAPSHOT_FORMATS,
  checkSnapshots,
  compareShapeNames,
  isReleasedSnapshotPath,
  snapshotPath,
  writeSnapshots,
  type SnapshotFormat,
} from "../../../packages/schemas/build/snapshots.js";
import { checkSchemas, readSchemasState, writeSchemas } from "../../../scripts/schemas-check.js";
import { RunRecordManifestSchema } from "../../../src/schemas/runRecord.js";
import { FORMAT_IDS, type FormatId } from "../../../src/schemas/schemaUrl.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const state = readSchemasState(repoRoot);
const committed = state.snapshotFiles;

const MANIFEST = "phase-record-manifest";
const NEXT = `snapshots/${MANIFEST}/next.schema.json`;
const V1 = `snapshots/${MANIFEST}/v1.schema.json`;
const V2 = `snapshots/${MANIFEST}/v2.schema.json`;

function withFiles(
  changes: Readonly<Record<string, string | undefined>>,
): ReadonlyMap<string, string> {
  const files = new Map(committed);
  for (const [path, content] of Object.entries(changes)) {
    if (content === undefined) files.delete(path);
    else files.set(path, content);
  }
  return files;
}

function withCurrent(id: FormatId, current: SnapshotFormat["current"]): SnapshotFormat[] {
  return SNAPSHOT_FORMATS.map((format) => (format.id === id ? { ...format, current } : format));
}

/** phax's phase record manifest with one more key: a shape change. */
const changedManifest = withCurrent(MANIFEST, {
  name: "next",
  schema: Schema.Struct({ ...RunRecordManifestSchema.fields, reviewer: Schema.String }),
});

function latestSnapshot(id: FormatId): string | undefined {
  const [latest] = [...committed.keys()]
    .filter((path) => path.startsWith(`snapshots/${id}/`) && isReleasedSnapshotPath(path))
    .toSorted((a, b) => compareShapeNames(shapeOf(b), shapeOf(a)));
  return latest === undefined ? undefined : committed.get(latest);
}

function shapeOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -".schema.json".length);
}

describe("the snapshot gate on the committed tree", () => {
  it("passes, and --write has nothing to write", () => {
    expect(checkSchemas(state)).toEqual([]);
    expect(writeSchemas(state).snapshots.size).toBe(0);
  });

  it("commits one snapshot per released shape, and no next snapshot", () => {
    expect([...committed.keys()]).toEqual(
      SNAPSHOT_FORMATS.flatMap((format) =>
        format.released.map((shape) => snapshotPath(format.id, shape.name)),
      ).toSorted(),
    );
    expect([...committed.keys()].filter((path) => path.endsWith("/next.schema.json"))).toEqual([]);
  });

  it.each(FORMAT_IDS)(
    "renders the latest %s snapshot with the packages/schemas/json/ renderer",
    (id) => {
      const { files, failures } = renderJsonSchemas(JSON_SCHEMA_FORMATS);
      expect(failures).toEqual([]);
      expect(latestSnapshot(id)).toBe(files.get(`${id}.schema.json`));
    },
  );
});

describe("a shape change must be recorded at its release", () => {
  it("fails an unrecorded change, naming the format and the next snapshot to record", () => {
    const findings = checkSnapshots(changedManifest, committed);
    expect(findings).toEqual([
      `✗ phase record manifest: the generated schema differs from the latest released snapshot ` +
        `and from packages/schemas/${NEXT} — record next.schema.json (run ${WRITE_COMMAND})`,
    ]);
    expect(checkSchemas({ ...state, snapshotFormats: changedManifest })).toEqual(findings);
  });

  it("passes once --write has recorded next.schema.json", () => {
    const written = writeSchemas({ ...state, snapshotFormats: changedManifest });
    expect([...written.snapshots.keys()]).toEqual([NEXT]);
    expect(written.mismatched).toEqual([]);
    const snapshotFiles = new Map([...committed, ...written.snapshots]);
    expect(checkSchemas({ ...state, snapshotFormats: changedManifest, snapshotFiles })).toEqual([]);
    // next is never pinned: the lock --write produces is the committed one.
    expect(written.lock).toBe(writeSchemas(state).lock);
  });

  it("fails a next snapshot that differs from the generated schema", () => {
    const files = withFiles({ [NEXT]: "{}\n" });
    const findings = checkSnapshots(changedManifest, files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(`packages/schemas/${NEXT} — record next.schema.json`);
    expect([...writeSnapshots(changedManifest, files).keys()]).toEqual([NEXT]);
  });

  it("reports a next snapshot that records no change", () => {
    const files = withFiles({ [NEXT]: committed.get(V2) });
    const findings = checkSnapshots(SNAPSHOT_FORMATS, files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(`packages/schemas/${NEXT}`);
    expect(findings[0]).toContain("records no change");
    expect(findings[0]).toContain("delete it");
    expect(writeSnapshots(SNAPSHOT_FORMATS, files).size).toBe(0);
  });
});

describe("released snapshots", () => {
  it("reports a missing released snapshot, and --write creates it", () => {
    const files = withFiles({ [V1]: undefined });
    const findings = checkSnapshots(SNAPSHOT_FORMATS, files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(`packages/schemas/${V1}`);
    expect(findings[0]).toContain(WRITE_COMMAND);
    expect(writeSnapshots(SNAPSHOT_FORMATS, files)).toEqual(new Map([[V1, committed.get(V1)]]));
  });

  it("creates a missing latest snapshot without recording next", () => {
    const files = withFiles({ [V2]: undefined });
    expect(checkSnapshots(SNAPSHOT_FORMATS, files)).toHaveLength(1);
    expect(writeSnapshots(SNAPSHOT_FORMATS, files)).toEqual(new Map([[V2, committed.get(V2)]]));
  });

  it("never puts an existing released snapshot in the write set", () => {
    const written = writeSnapshots(changedManifest, withFiles({ [V2]: "{}\n" }));
    expect([...written.keys()]).toEqual([NEXT]);
  });

  it("fails an edited released snapshot through the lock, and --write writes nothing", () => {
    const snapshotFiles = withFiles({ [V1]: "{}\n" });
    const findings = checkSchemas({ ...state, snapshotFiles });
    expect(findings).toEqual([
      expect.stringContaining(
        `✗ packages/schemas/${V1} differs from its history.lock.json entry — a released snapshot never changes`,
      ),
    ]);
    expect(writeSchemas({ ...state, snapshotFiles }).mismatched).toEqual([V1]);
  });

  it("fails a released snapshot without a lock entry, and a lock entry without its snapshot", () => {
    const { [V1]: _pinned, ...lock } = state.lock;
    expect(checkSchemas({ ...state, lock })).toEqual([
      `✗ packages/schemas/${V1} has no history.lock.json entry — run ${WRITE_COMMAND}`,
    ]);
    const extra = "snapshots/registry/v0.schema.json";
    const [finding, ...rest] = checkSchemas({ ...state, lock: { ...state.lock, [extra]: "0" } });
    expect(rest).toEqual([]);
    expect(finding).toContain(`names packages/schemas/${extra}, which does not exist`);
    expect(finding).toContain("restore the snapshot");
  });
});

describe("compareShapeNames and the latest released snapshot", () => {
  it("orders v<N> numerically, then releases numerically", () => {
    const names = ["0.17.0", "v10", "0.10.0", "v2", "0.9.0", "v1"];
    expect(names.toSorted(compareShapeNames)).toEqual([
      "v1",
      "v2",
      "v10",
      "0.9.0",
      "0.10.0",
      "0.17.0",
    ]);
  });

  it("takes a present release-named snapshot over v2 as the latest released", () => {
    const release = `snapshots/${MANIFEST}/0.17.0.schema.json`;
    expect(checkSnapshots(SNAPSHOT_FORMATS, withFiles({ [release]: "{}\n" }))).toEqual([
      expect.stringContaining("the generated schema differs from the latest released snapshot"),
    ]);
    const renamed = withFiles({ [release]: committed.get(V2), [V2]: "{}\n" });
    expect(checkSnapshots(SNAPSHOT_FORMATS, renamed)).toEqual([]);
  });

  it("pins v<N> and release-named snapshots, never next", () => {
    expect(isReleasedSnapshotPath(V2)).toBe(true);
    expect(isReleasedSnapshotPath(`snapshots/${MANIFEST}/0.17.0.schema.json`)).toBe(true);
    expect(isReleasedSnapshotPath(NEXT)).toBe(false);
    expect(isReleasedSnapshotPath("snapshots/unknown/v1.schema.json")).toBe(false);
  });
});

describe("malformed snapshot trees", () => {
  it("reports a badly named snapshot file and an unknown format directory", () => {
    const badPaths = [
      `snapshots/${MANIFEST}/latest.schema.json`,
      `snapshots/${MANIFEST}/v2.json`,
      `snapshots/${MANIFEST}/v01.schema.json`,
      "snapshots/code-reviews/v1.schema.json",
      "snapshots/v1.schema.json",
      `snapshots/${MANIFEST}/nested/v1.schema.json`,
    ];
    const findings = checkSnapshots(
      SNAPSHOT_FORMATS,
      withFiles(Object.fromEntries(badPaths.map((path) => [path, "{}\n"]))),
    );
    expect(findings).toHaveLength(badPaths.length);
    for (const path of badPaths) {
      expect(findings.some((finding) => finding.includes(`packages/schemas/${path} `))).toBe(true);
    }
  });

  it("reports, named, a format whose schema JSON Schema cannot express", () => {
    const refined = withCurrent("registry", {
      name: "v1",
      schema: Schema.Struct({ name: Schema.String.pipe(Schema.filter((s) => s.length > 2)) }),
    });
    const findings = checkSnapshots(refined, committed);
    expect(findings).toEqual([
      "✗ run registry: JSON Schema cannot express the refinement at name — give it a jsonSchema annotation",
    ]);
    expect(writeSnapshots(refined, committed).size).toBe(0);
  });
});
