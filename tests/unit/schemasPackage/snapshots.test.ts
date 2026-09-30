import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { WRITE_COMMAND } from "../../../packages/schemas/build/generated.js";
import { renderJsonSchemas } from "../../../packages/schemas/build/jsonSchemas.js";
import {
  SNAPSHOTS_DIR,
  checkSnapshots,
  latestReleased,
  parseSnapshotName,
  planSnapshotWrites,
  snapshotPath,
  type SnapshotFormat,
  type SnapshotsInput,
} from "../../../packages/schemas/build/snapshots.js";
import { readSchemasState } from "../../../scripts/schemas-check.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ID = "phase-record-manifest";
const PRE_SCHEMA_PATH = `${SNAPSHOTS_DIR}/${ID}/pre-schema.schema.json`;
const NEXT_PATH = `${SNAPSHOTS_DIR}/${ID}/next.schema.json`;

/** What `renderJsonSchemas` renders for a toy struct under the id `phase-record-manifest`. */
function render(schema: Schema.Schema.Any): string {
  const { files, failures } = renderJsonSchemas([
    { format: ID, fileName: `${ID}.schema.json`, title: "toy", schema, excess: "error" },
  ]);
  expect(failures).toEqual([]);
  const content = files.get(`${ID}.schema.json`);
  if (content === undefined) throw new Error("toy schema did not render");
  return content;
}

const original = render(Schema.Struct({ name: Schema.String }));
const widened = render(Schema.Struct({ name: Schema.String, count: Schema.Number }));
const narrowed = render(Schema.Struct({ count: Schema.Number }));

function format(content: string, currentShape = "pre-schema"): SnapshotFormat {
  return { id: ID, currentShape, generated: { ok: true, content } };
}

function input(
  generated: SnapshotFormat,
  files: Record<string, string>,
  extra: Record<string, Record<string, string>> = {},
  snapshotRootFiles: ReadonlyArray<string> = [],
): SnapshotsInput {
  const snapshots = new Map<string, ReadonlyMap<string, string>>();
  if (Object.keys(files).length > 0) snapshots.set(ID, new Map(Object.entries(files)));
  for (const [dir, dirFiles] of Object.entries(extra)) {
    snapshots.set(dir, new Map(Object.entries(dirFiles)));
  }
  return { formats: [generated], snapshots, snapshotRootFiles };
}

/** The state after `--write`'s plan is applied to it. */
function apply(state: SnapshotsInput): SnapshotsInput {
  const { writes, removals } = planSnapshotWrites(state);
  const snapshots = new Map<string, Map<string, string>>();
  for (const [dir, files] of state.snapshots) snapshots.set(dir, new Map(files));
  for (const [path, content] of writes) {
    const [dir, file] = path.slice(SNAPSHOTS_DIR.length + 1).split("/") as [string, string];
    const files = snapshots.get(dir) ?? new Map<string, string>();
    files.set(file, content);
    snapshots.set(dir, files);
  }
  for (const path of removals) {
    const [dir, file] = path.slice(SNAPSHOTS_DIR.length + 1).split("/") as [string, string];
    snapshots.get(dir)?.delete(file);
  }
  return { ...state, snapshots };
}

// Invariants of the committed tree that hold whatever shapes it records, before
// and after a `next` snapshot exists.
describe("snapshots on the committed tree", () => {
  const state = readSchemasState(repoRoot);

  it("passes the snapshot check", () => {
    expect(state.snapshots.size).toBeGreaterThan(0);
    expect(checkSnapshots(state)).toEqual([]);
  });

  it("--write changes nothing", () => {
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });
});

describe("snapshot names", () => {
  it("parses pre-schema, next and releases, and nothing else", () => {
    expect(parseSnapshotName("pre-schema.schema.json")).toBe("pre-schema");
    expect(parseSnapshotName("next.schema.json")).toBe("next");
    expect(parseSnapshotName("0.10.0.schema.json")).toBe("0.10.0");
    expect(parseSnapshotName("v1.schema.json")).toBeUndefined();
    expect(parseSnapshotName("0.10.schema.json")).toBeUndefined();
    expect(parseSnapshotName("pre-schema.json")).toBeUndefined();
  });

  it("orders 0.10.0 above 0.9.0 and every release above pre-schema", () => {
    expect(latestReleased(["0.9.0", "0.10.0", "pre-schema", "next"])).toBe("0.10.0");
    expect(latestReleased(["pre-schema", "0.1.0"])).toBe("0.1.0");
    expect(latestReleased(["0.1.0", "pre-schema"])).toBe("0.1.0");
    expect(latestReleased(["pre-schema", "next"])).toBe("pre-schema");
    expect(latestReleased(["next"])).toBeUndefined();
  });

  it("builds the path under the snapshots directory", () => {
    expect(snapshotPath(ID, "next")).toBe(NEXT_PATH);
  });
});

describe("the snapshot gate (ac-snapshot-gate)", () => {
  it("passes when the generated schema equals the latest released snapshot", () => {
    const state = input(format(original), { "pre-schema.schema.json": original });
    expect(checkSnapshots(state)).toEqual([]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });

  it("compares as parsed JSON: a reformatted snapshot records the same shape", () => {
    const reformatted = JSON.stringify(JSON.parse(original));
    expect(
      checkSnapshots(input(format(original), { "pre-schema.schema.json": reformatted })),
    ).toEqual([]);
  });

  it("fails a shape change without next, naming the format and the next snapshot to record", () => {
    const state = input(format(widened), { "pre-schema.schema.json": original });
    const findings = checkSnapshots(state);
    expect(findings).toEqual([
      `✗ ${ID}: the generated schema differs from the latest released snapshot ${PRE_SCHEMA_PATH} ` +
        `and from ${NEXT_PATH} — record ${NEXT_PATH} (run ${WRITE_COMMAND})`,
    ]);
    const { writes, removals } = planSnapshotWrites(state);
    expect(writes).toEqual(new Map([[NEXT_PATH, widened]]));
    expect(removals).toEqual([]);
    const applied = apply(state);
    expect(applied.snapshots.get(ID)?.get("pre-schema.schema.json")).toBe(original);
    expect(checkSnapshots(applied)).toEqual([]);
    expect(planSnapshotWrites(applied)).toEqual({ writes: new Map(), removals: [] });
  });

  it("compares against the highest release, not pre-schema", () => {
    const state = input(format(widened), {
      "pre-schema.schema.json": original,
      "0.9.0.schema.json": original,
      "0.10.0.schema.json": widened,
    });
    expect(checkSnapshots(state)).toEqual([]);
    const regressed = input(format(original), {
      "pre-schema.schema.json": original,
      "0.9.0.schema.json": original,
      "0.10.0.schema.json": widened,
    });
    expect(checkSnapshots(regressed)[0]).toContain(`${SNAPSHOTS_DIR}/${ID}/0.10.0.schema.json`);
  });

  it("reports and removes a next equal to the latest released snapshot", () => {
    const state = input(format(original), {
      "pre-schema.schema.json": original,
      "next.schema.json": original,
    });
    expect(checkSnapshots(state)).toEqual([
      `✗ ${NEXT_PATH} equals the latest released snapshot ${PRE_SCHEMA_PATH} — delete it (run ${WRITE_COMMAND})`,
    ]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [NEXT_PATH] });
    expect(checkSnapshots(apply(state))).toEqual([]);
  });

  it("reports and rewrites a stale next", () => {
    const state = input(format(narrowed), {
      "pre-schema.schema.json": original,
      "next.schema.json": widened,
    });
    expect(checkSnapshots(state)).toEqual([
      `✗ ${NEXT_PATH} differs from the generated schema — run ${WRITE_COMMAND}`,
    ]);
    expect(planSnapshotWrites(state).writes).toEqual(new Map([[NEXT_PATH, narrowed]]));
    expect(checkSnapshots(apply(state))).toEqual([]);
  });

  it("never writes a differing released snapshot", () => {
    const state = input(format(widened), {
      "pre-schema.schema.json": original,
      "0.1.0.schema.json": narrowed,
    });
    const { writes, removals } = planSnapshotWrites(state);
    expect([...writes.keys()]).toEqual([NEXT_PATH]);
    expect(removals).toEqual([]);
  });

  it("bootstraps a format with no snapshot under its current shape's name", () => {
    const missing = input(format(original), {});
    expect(checkSnapshots(missing)).toEqual([`✗ ${ID}: no snapshot — run ${WRITE_COMMAND}`]);
    expect(planSnapshotWrites(missing).writes).toEqual(new Map([[PRE_SCHEMA_PATH, original]]));
    expect(checkSnapshots(apply(missing))).toEqual([]);
    const released = input(format(original, "next"), {});
    expect(planSnapshotWrites(released).writes).toEqual(new Map([[NEXT_PATH, original]]));
    expect(checkSnapshots(apply(released))).toEqual([]);
  });
});

describe("stray snapshot files", () => {
  it("reports a directory that names no format, and leaves it alone", () => {
    const state = input(
      format(original),
      { "pre-schema.schema.json": original },
      { "not-a-format": { "pre-schema.schema.json": original } },
    );
    expect(checkSnapshots(state)).toEqual([`✗ ${SNAPSHOTS_DIR}/not-a-format/ names no format`]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });

  it("reports a file outside every format directory, and leaves it alone", () => {
    const state = input(format(original), { "pre-schema.schema.json": original }, {}, [
      "registry.schema.json",
    ]);
    expect(checkSnapshots(state)).toEqual([
      `✗ ${SNAPSHOTS_DIR}/registry.schema.json is outside every format directory`,
    ]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });

  it("ignores hidden files and directories everywhere", () => {
    const state = input(
      format(original),
      { "pre-schema.schema.json": original, ".DS_Store": "", ".cache/next.schema.json": "{" },
      { ".git-keep": { "notes.txt": "" } },
      [".DS_Store"],
    );
    expect(checkSnapshots(state)).toEqual([]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });

  it("reports a file whose name is not a snapshot name", () => {
    const state = input(format(original), {
      "pre-schema.schema.json": original,
      "v1.json": original,
    });
    expect(checkSnapshots(state)).toEqual([
      `✗ ${SNAPSHOTS_DIR}/${ID}/v1.json is not a snapshot name (pre-schema, next or X.Y.Z, then .schema.json)`,
    ]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });

  it("reports a snapshot that is not valid JSON", () => {
    const state = input(format(original), {
      "pre-schema.schema.json": original,
      "0.1.0.schema.json": "{",
    });
    const findings = checkSnapshots(state);
    expect(findings[0]).toBe(`✗ ${SNAPSHOTS_DIR}/${ID}/0.1.0.schema.json is not valid JSON`);
    expect(planSnapshotWrites(state).writes.has(`${SNAPSHOTS_DIR}/${ID}/0.1.0.schema.json`)).toBe(
      false,
    );
  });

  it("reports a format that failed to render, and skips it on --write", () => {
    const state: SnapshotsInput = {
      formats: [{ id: ID, currentShape: "pre-schema", generated: { ok: false, reason: "boom" } }],
      snapshots: new Map(),
      snapshotRootFiles: [],
    };
    expect(checkSnapshots(state)).toEqual([`✗ ${ID}: boom`]);
    expect(planSnapshotWrites(state)).toEqual({ writes: new Map(), removals: [] });
  });
});
