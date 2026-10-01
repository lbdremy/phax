// Pure rules behind the snapshot half of scripts/schemas-check.ts: every
// format's current shape is recorded as a JSON Schema snapshot under
// packages/schemas/snapshots/<format id>/, named `pre-schema`, a release
// `X.Y.Z` or `next`. A released snapshot never changes; a shape change is
// recorded as `next`, which the release renames to the release it ships in.
// Snapshots are compared as parsed JSON, so reformatting one changes nothing.
// A hidden entry (its name starts with `.`, like .DS_Store) is ignored
// everywhere; any other unexpected file or directory is a finding.
import { isDeepStrictEqual } from "node:util";
import {
  compareReleases,
  isFormatId,
  isRelease,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import { WRITE_COMMAND } from "./generated.js";

export const SNAPSHOTS_DIR = "packages/schemas/snapshots";

const SUFFIX = ".schema.json";
const NEXT = "next";
const PRE_SCHEMA = "pre-schema";

/** True for a path with a hidden segment (`.DS_Store`, `.cache/x`): never a snapshot, never reported. */
function isHidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

export function snapshotPath(formatId: string, name: string): string {
  return `${SNAPSHOTS_DIR}/${formatId}/${name}${SUFFIX}`;
}

/** The snapshot name a file name records (`pre-schema`, `next` or `X.Y.Z`), or undefined. */
export function parseSnapshotName(fileName: string): string | undefined {
  if (!fileName.endsWith(SUFFIX)) return undefined;
  const name = fileName.slice(0, -SUFFIX.length);
  return name === PRE_SCHEMA || name === NEXT || isRelease(name) ? name : undefined;
}

/**
 * The latest released snapshot name: the highest release, else `pre-schema`
 * when present, else undefined. `next` is not released.
 */
export function latestReleased(names: Iterable<string>): string | undefined {
  let latest: string | undefined;
  for (const name of names) {
    if (isRelease(name)) {
      if (latest === undefined || latest === PRE_SCHEMA || compareReleases(name, latest) > 0) {
        latest = name;
      }
    } else if (name === PRE_SCHEMA && latest === undefined) {
      latest = name;
    }
  }
  return latest;
}

/**
 * The first supported release: the lowest release-named snapshot (`X.Y.Z`)
 * across every format directory, or null when there is none. `pre-schema`
 * and `next` are not releases; a directory that names no format and a hidden
 * entry are ignored.
 */
export function firstSupportedRelease(
  snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string | null {
  let lowest: string | null = null;
  for (const [dir, files] of snapshots) {
    if (isHidden(dir) || !isFormatId(dir)) continue;
    for (const fileName of files.keys()) {
      const name = parseSnapshotName(fileName);
      if (name === undefined || !isRelease(name)) continue;
      if (lowest === null || compareReleases(name, lowest) < 0) lowest = name;
    }
  }
  return lowest;
}

export interface SnapshotFormat {
  readonly id: FormatId;
  /** The format's current shape name: `pre-schema`, `next` or a release. */
  readonly currentShape: string;
  /** What `renderJsonSchemas` renders for the format id, or why it could not. */
  readonly generated:
    | { readonly ok: true; readonly content: string }
    | { readonly ok: false; readonly reason: string };
}

export interface SnapshotsInput {
  readonly formats: ReadonlyArray<SnapshotFormat>;
  /** Directory name under `SNAPSHOTS_DIR` → file name → content. */
  readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The names of the files directly under `SNAPSHOTS_DIR`, outside every format directory. */
  readonly snapshotRootFiles: ReadonlyArray<string>;
}

function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) as unknown };
  } catch {
    return { ok: false };
  }
}

function sameJson(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const left = parseJson(a);
  const right = parseJson(b);
  return left.ok && right.ok && isDeepStrictEqual(left.value, right.value);
}

interface FormatSnapshots {
  /** Snapshot name → content, for every file whose name is a snapshot name. */
  readonly byName: ReadonlyMap<string, string>;
  readonly latest: string | undefined;
  readonly next: string | undefined;
}

function formatSnapshots(files: ReadonlyMap<string, string> | undefined): FormatSnapshots {
  const byName = new Map<string, string>();
  for (const [fileName, content] of files ?? []) {
    const name = parseSnapshotName(fileName);
    if (name !== undefined) byName.set(name, content);
  }
  return { byName, latest: latestReleased(byName.keys()), next: byName.get(NEXT) };
}

/** Every snapshot finding, one `✗ …` line each; empty when the snapshots are current. */
export function checkSnapshots(input: SnapshotsInput): string[] {
  const findings: string[] = [];
  for (const file of input.snapshotRootFiles) {
    if (isHidden(file)) continue;
    findings.push(`✗ ${SNAPSHOTS_DIR}/${file} is outside every format directory`);
  }
  for (const [dir, files] of input.snapshots) {
    if (isHidden(dir)) continue;
    if (!isFormatId(dir)) {
      findings.push(`✗ ${SNAPSHOTS_DIR}/${dir}/ names no format`);
      continue;
    }
    for (const [fileName, content] of files) {
      if (isHidden(fileName)) continue;
      const path = `${SNAPSHOTS_DIR}/${dir}/${fileName}`;
      if (parseSnapshotName(fileName) === undefined) {
        findings.push(
          `✗ ${path} is not a snapshot name (pre-schema, next or X.Y.Z, then ${SUFFIX})`,
        );
      } else if (!parseJson(content).ok) {
        findings.push(`✗ ${path} is not valid JSON`);
      }
    }
  }
  for (const format of input.formats) {
    if (!format.generated.ok) {
      findings.push(`✗ ${format.id}: ${format.generated.reason}`);
      continue;
    }
    const generated = format.generated.content;
    const { byName, latest, next } = formatSnapshots(input.snapshots.get(format.id));
    const nextPath = snapshotPath(format.id, NEXT);
    if (latest === undefined && next === undefined) {
      findings.push(`✗ ${format.id}: no snapshot — run ${WRITE_COMMAND}`);
      continue;
    }
    const latestContent = latest === undefined ? undefined : byName.get(latest);
    if (next === undefined) {
      if (!sameJson(latestContent, generated)) {
        const latestPath = snapshotPath(format.id, latest ?? PRE_SCHEMA);
        findings.push(
          `✗ ${format.id}: the generated schema differs from the latest released snapshot ${latestPath} ` +
            `and from ${nextPath} — record ${nextPath} (run ${WRITE_COMMAND})`,
        );
      }
      continue;
    }
    if (!sameJson(next, generated)) {
      findings.push(`✗ ${nextPath} differs from the generated schema — run ${WRITE_COMMAND}`);
    }
    if (latest !== undefined && sameJson(latestContent, next)) {
      findings.push(
        `✗ ${nextPath} equals the latest released snapshot ${snapshotPath(format.id, latest)} — ` +
          `delete it (run ${WRITE_COMMAND})`,
      );
    }
  }
  return findings;
}

/**
 * What `--write` does to the snapshots. A format with no snapshot gets its
 * current shape's (`pre-schema`, else `next`); one whose generated schema
 * differs from its latest released snapshot gets `next` (re)written; one
 * whose generated schema equals it loses any `next`. A released snapshot is
 * never written once it exists, nor removed. Stray directories and files, and
 * formats that failed to render, are left alone.
 */
export function planSnapshotWrites(input: SnapshotsInput): {
  readonly writes: ReadonlyMap<string, string>;
  readonly removals: ReadonlyArray<string>;
} {
  const writes = new Map<string, string>();
  const removals: string[] = [];
  for (const format of input.formats) {
    if (!format.generated.ok) continue;
    const generated = format.generated.content;
    const { byName, latest, next } = formatSnapshots(input.snapshots.get(format.id));
    const nextPath = snapshotPath(format.id, NEXT);
    if (latest === undefined && next === undefined) {
      const name = format.currentShape === PRE_SCHEMA ? PRE_SCHEMA : NEXT;
      writes.set(snapshotPath(format.id, name), generated);
    } else if (latest !== undefined && sameJson(byName.get(latest), generated)) {
      if (next !== undefined) removals.push(nextPath);
    } else if (!sameJson(next, generated)) {
      writes.set(nextPath, generated);
    }
  }
  return { writes, removals };
}
