// Pure snapshot gate behind scripts/schemas-check.ts: one committed JSON
// Schema per shape of every format, under snapshots/<format id>/<shape>.schema.json
// (relative to packages/schemas). The schema generated from phax's current
// decoder must equal the latest released snapshot, unless
// snapshots/<format id>/next.schema.json records it (spec §5.16).
import type { Schema } from "effect";
import {
  FORMAT_IDS,
  compareReleases,
  isFormatId,
  isRelease,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import { WRITE_COMMAND } from "./generated.js";
import { FORMAT_DEFINITIONS, renderShapeJsonSchema, type FormatShapes } from "./jsonSchemas.js";

const PACKAGE_DIR = "packages/schemas";
const SNAPSHOTS_DIR = "snapshots";
const SUFFIX = ".schema.json";
const NEXT = "next";

/** One shape of a format and the schema its snapshot is rendered from. */
export interface SnapshotShape {
  readonly name: string;
  readonly schema: Schema.Schema.Any;
}

export interface SnapshotFormat {
  readonly id: FormatId;
  readonly label: string;
  /** Every shape that has a released snapshot, in shape order. */
  readonly released: ReadonlyArray<SnapshotShape>;
  /** The shape phax writes today, rendered from phax's own decoder. */
  readonly current: SnapshotShape;
}

/** `snapshots/<format id>/<shape>.schema.json`, relative to packages/schemas. */
export function snapshotPath(format: FormatId, shape: string): string {
  return `${SNAPSHOTS_DIR}/${format}/${shape}${SUFFIX}`;
}

const LEGACY_NAME = /^v(0|[1-9]\d*)$/;

function legacyNumber(name: string): number | undefined {
  return LEGACY_NAME.test(name) ? Number(name.slice(1)) : undefined;
}

/** 0 for `v<N>`, 1 for a release, 2 for anything else (`next`). */
function shapeRank(name: string): number {
  if (legacyNumber(name) !== undefined) return 0;
  return isRelease(name) ? 1 : 2;
}

/**
 * Orders shape names: every `v<N>` by N, then every release by
 * compareReleases. `next` is never released and sorts last.
 */
export function compareShapeNames(a: string, b: string): number {
  const rank = shapeRank(a) - shapeRank(b);
  if (rank !== 0) return rank;
  const left = legacyNumber(a);
  const right = legacyNumber(b);
  if (left !== undefined && right !== undefined) return left - right;
  if (isRelease(a) && isRelease(b)) return compareReleases(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isReleasedShapeName(name: string): boolean {
  return shapeRank(name) < 2;
}

/** A snapshot path split into its format directory and shape name, when well formed. */
function parseSnapshotPath(path: string): { format: FormatId; shape: string } | undefined {
  const segments = path.split("/");
  if (segments.length !== 3 || segments[0] !== SNAPSHOTS_DIR) return undefined;
  const [, format = "", file = ""] = segments;
  if (!isFormatId(format) || !file.endsWith(SUFFIX)) return undefined;
  const shape = file.slice(0, -SUFFIX.length);
  return isReleasedShapeName(shape) || shape === NEXT ? { format, shape } : undefined;
}

/** A well-formed snapshot of a released shape: what history.lock.json pins. `next` is never pinned. */
export function isReleasedSnapshotPath(path: string): boolean {
  const parsed = parseSnapshotPath(path);
  return parsed !== undefined && parsed.shape !== NEXT;
}

function snapshotFormat(definition: FormatShapes): SnapshotFormat {
  const current = { name: definition.current.name, schema: definition.current.shape.schema };
  const released = new Map<string, Schema.Schema.Any>();
  for (const [literal, shape] of Object.entries(definition.legacy)) {
    if (shape !== undefined) released.set(`v${literal}`, shape.schema);
  }
  for (const [release, shape] of definition.releases) released.set(release, shape.schema);
  // The current shape's snapshot is rendered from phax's own decoder, not from
  // its frozen twin: the frozen run-status v1, phax-plan v1 and
  // phase-file-reconciliation v0 are deliberately broader than what phax
  // writes, one literal covering several written shapes (§5.13). A snapshot
  // records what phax writes.
  if (current.name !== NEXT) released.set(current.name, current.schema);
  return {
    id: definition.id,
    label: definition.label,
    released: [...released]
      .toSorted(([a], [b]) => compareShapeNames(a, b))
      .map(([name, schema]) => ({ name, schema })),
    current,
  };
}

/** Every format's snapshot table, in FORMAT_IDS order. */
export const SNAPSHOT_FORMATS: ReadonlyArray<SnapshotFormat> = FORMAT_IDS.map((id) =>
  snapshotFormat(FORMAT_DEFINITIONS[id]),
);

/** The content of the highest-ordered released snapshot among `files`, if any. */
function latestReleased(format: FormatId, files: ReadonlyMap<string, string>): string | undefined {
  let latest: { shape: string; content: string } | undefined;
  for (const [path, content] of files) {
    const parsed = parseSnapshotPath(path);
    if (parsed === undefined || parsed.format !== format || parsed.shape === NEXT) continue;
    if (latest === undefined || compareShapeNames(parsed.shape, latest.shape) > 0) {
      latest = { shape: parsed.shape, content };
    }
  }
  return latest?.content;
}

/** One format's findings and the files `--write` adds for it. */
function planFormat(
  format: SnapshotFormat,
  files: ReadonlyMap<string, string>,
): { findings: string[]; writes: Map<string, string> } {
  const findings: string[] = [];
  const writes = new Map<string, string>();
  for (const shape of format.released) {
    const path = snapshotPath(format.id, shape.name);
    if (files.has(path)) continue;
    const rendered = renderShapeJsonSchema(format.id, shape.schema);
    if (!rendered.ok) {
      findings.push(`✗ ${format.label} ${shape.name}: ${rendered.reason}`);
      continue;
    }
    findings.push(`✗ ${PACKAGE_DIR}/${path} is missing — run ${WRITE_COMMAND}`);
    writes.set(path, rendered.content);
  }

  const generated = renderShapeJsonSchema(format.id, format.current.schema);
  if (!generated.ok) {
    findings.push(`✗ ${format.label}: ${generated.reason}`);
    return { findings, writes };
  }
  // A missing released snapshot is already reported; judge next against the
  // tree --write leaves, so the missing snapshot is not reported twice.
  const latest = latestReleased(format.id, new Map([...files, ...writes]));
  const nextPath = snapshotPath(format.id, NEXT);
  const next = files.get(nextPath);
  if (generated.content !== latest && next !== generated.content) {
    findings.push(
      `✗ ${format.label}: the generated schema differs from the latest released snapshot and from ` +
        `${PACKAGE_DIR}/${nextPath} — record next.schema.json (run ${WRITE_COMMAND})`,
    );
    writes.set(nextPath, generated.content);
  } else if (generated.content === latest && next !== undefined) {
    findings.push(
      `✗ ${PACKAGE_DIR}/${nextPath} records no change: the generated ${format.label} schema ` +
        `equals the latest released snapshot — delete it`,
    );
  }
  return { findings, writes };
}

function malformedFinding(path: string): string {
  const [, directory = ""] = path.split("/");
  return path.split("/").length === 3 && !isFormatId(directory)
    ? `✗ ${PACKAGE_DIR}/${path} is not in a format directory — ${directory} is not a format id`
    : `✗ ${PACKAGE_DIR}/${path} is not named v<N>${SUFFIX}, <X.Y.Z>${SUFFIX} or ${NEXT}${SUFFIX}`;
}

/**
 * Every snapshot finding, one `✗ …` line each: each format's malformed file
 * names, missing snapshots, unrenderable schemas and unrecorded or stale
 * `next`, in format order; then malformed paths outside the table's formats.
 * `files` maps a path relative to packages/schemas to its content.
 */
export function checkSnapshots(
  formats: ReadonlyArray<SnapshotFormat>,
  files: ReadonlyMap<string, string>,
): string[] {
  const malformed = [...files.keys()].filter((path) => parseSnapshotPath(path) === undefined);
  const inFormat = (id: FormatId, path: string): boolean =>
    path.startsWith(`${SNAPSHOTS_DIR}/${id}/`);
  const reported = new Set<string>();
  const findings: string[] = [];
  for (const format of formats) {
    for (const path of malformed.filter((candidate) => inFormat(format.id, candidate))) {
      reported.add(path);
      findings.push(malformedFinding(path));
    }
    findings.push(...planFormat(format, files).findings);
  }
  for (const path of malformed.filter((candidate) => !reported.has(candidate)).toSorted()) {
    findings.push(malformedFinding(path));
  }
  return findings;
}

/**
 * The files `--write` writes: every missing released snapshot, and
 * `next.schema.json` when the generated schema differs from the latest
 * released snapshot and next does not already record it. Never an existing
 * released snapshot; never a deletion.
 */
export function writeSnapshots(
  formats: ReadonlyArray<SnapshotFormat>,
  files: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  return new Map(formats.flatMap((format) => [...planFormat(format, files).writes]));
}
