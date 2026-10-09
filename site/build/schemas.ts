// The JSON Schemas docs.phax.run serves at every `$schema` URL a released
// phax writes. The release ledger (packages/schemas/releases.json, appended
// by the release cut) lists every cut release, never the opened version
// package.json names between releases; for each release and each format,
// the format's latest release-named snapshot at or before that release is
// served at /schemas/<format id>/<release>.json, byte for byte. `pre-schema`
// and `next` are never served. A retired format (no longer in FORMAT_IDS)
// keeps the URLs it was served at: each frozen copy under
// site/retired-schemas/<format id>/<release>.json is served byte for byte at
// /schemas/<format id>/<release>.json, and nothing is served for a release
// it has no copy for. Pure, except readSchemaSources.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SNAPSHOTS_DIR,
  parseSnapshotName,
  snapshotPath,
} from "../../packages/schemas/build/snapshots.js";
import {
  FORMAT_IDS,
  SCHEMA_URL_BASE,
  compareReleases,
  isFormatId,
  isRelease,
} from "../../src/schemas/schemaUrl.js";

export const LEDGER_PATH = "packages/schemas/releases.json";
export const RETIRED_SCHEMAS_DIR = "site/retired-schemas";

/** packages/schemas/releases.json: every release, oldest first. */
export interface ReleaseLedger {
  readonly releases: ReadonlyArray<string>;
}

/** /schemas/index.json: the releases and every path a build serves, both sorted. */
export interface SchemaIndex {
  readonly releases: ReadonlyArray<string>;
  readonly paths: ReadonlyArray<string>;
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** The ledger `text` holds, or undefined when it is not `{ "releases": [string, …] }`. */
export function parseLedger(text: string): ReleaseLedger | undefined {
  try {
    const value = JSON.parse(text) as { readonly releases?: unknown } | null;
    if (typeof value !== "object" || value === null || !isStringArray(value.releases)) {
      return undefined;
    }
    return { releases: value.releases };
  } catch {
    return undefined;
  }
}

/** The schema index `text` holds, or undefined when it is not `{ releases, paths }`. */
export function parseSchemaIndex(text: string): SchemaIndex | undefined {
  try {
    const value = JSON.parse(text) as {
      readonly releases?: unknown;
      readonly paths?: unknown;
    } | null;
    if (
      typeof value !== "object" ||
      value === null ||
      !isStringArray(value.releases) ||
      !isStringArray(value.paths)
    ) {
      return undefined;
    }
    return { releases: value.releases, paths: value.paths };
  } catch {
    return undefined;
  }
}

/** The lowest release-named snapshot across every format, or undefined. */
function firstSnapshotRelease(
  snapshotNames: ReadonlyMap<string, ReadonlyArray<string>>,
): string | undefined {
  let lowest: string | undefined;
  for (const [formatId, names] of snapshotNames) {
    if (!isFormatId(formatId)) continue;
    for (const name of names) {
      if (isRelease(name) && (lowest === undefined || compareReleases(name, lowest) < 0)) {
        lowest = name;
      }
    }
  }
  return lowest;
}

/**
 * Every finding about the ledger, as `✗ …` lines: an entry that is not
 * X.Y.Z, entries not strictly increasing, a first entry that is not the first
 * supported release, a last entry above the package.json version, and a
 * release-named snapshot whose release the ledger lacks. Between releases
 * package.json names the opened version, which the ledger trails until the
 * cut appends it; on a release commit the two are equal. `snapshotNames`
 * maps a format id to its snapshot names (`pre-schema`, `next`, `X.Y.Z`).
 */
export function checkLedger(
  ledger: ReleaseLedger,
  packageVersion: string,
  snapshotNames: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<string> {
  const findings: Array<string> = [];
  const { releases } = ledger;
  const first = releases[0];
  const last = releases.at(-1);
  if (first === undefined || last === undefined) return ["✗ release ledger: lists no release"];

  for (const release of releases) {
    if (!isRelease(release)) findings.push(`✗ release ledger: "${release}" is not X.Y.Z`);
  }
  releases.forEach((release, index) => {
    const previous = releases[index - 1];
    if (previous === undefined || !isRelease(previous) || !isRelease(release)) return;
    if (compareReleases(release, previous) <= 0) {
      findings.push(
        `✗ release ledger: ${release} follows ${previous}; entries must be strictly increasing`,
      );
    }
  });
  const firstSupported = firstSnapshotRelease(snapshotNames);
  if (firstSupported === undefined) {
    findings.push(`✗ release ledger: first entry ${first}, but no snapshot names a release`);
  } else if (first !== firstSupported) {
    findings.push(
      `✗ release ledger: first entry ${first}, first supported release ${firstSupported}`,
    );
  }
  if (isRelease(last) && isRelease(packageVersion) && compareReleases(last, packageVersion) > 0) {
    findings.push(
      `✗ release ledger: last entry ${last} is above package.json version ${packageVersion}`,
    );
  }
  const listed = new Set(releases);
  for (const [formatId, names] of [...snapshotNames].toSorted(([left], [right]) =>
    left < right ? -1 : 1,
  )) {
    if (!isFormatId(formatId)) continue;
    for (const name of [...names].filter(isRelease).toSorted(compareReleases)) {
      if (!listed.has(name)) {
        findings.push(
          `✗ ${snapshotPath(formatId, name)}: release ${name} is not in the release ledger`,
        );
      }
    }
  }
  return findings;
}

/** The URL path a format's schema at `release` is served from. */
export function servedPath(formatId: string, release: string): string {
  return `/schemas/${formatId}/${release}.json`;
}

/** The public URL of a served path: `https://docs.phax.run/schemas/<id>/<release>.json`. */
export function servedUrl(path: string): string {
  return `${SCHEMA_URL_BASE}${path.slice("/schemas".length)}`;
}

export const SCHEMA_INDEX_PATH = "/schemas/index.json";
export const HEADERS_PATH = "/_headers";

export interface ServedSchemas<T> {
  /** URL path (`/schemas/<id>/<release>.json`) → the snapshot's content, sorted by path. */
  readonly files: ReadonlyMap<string, T>;
  /** /schemas/index.json: 2-space JSON plus a newline. */
  readonly index: string;
  /** _headers: answers /schemas/* as JSON readable from any origin. */
  readonly headers: string;
}

export const SCHEMA_HEADERS = [
  "/schemas/*",
  "  Content-Type: application/json",
  "  Access-Control-Allow-Origin: *",
  "  Cache-Control: public, max-age=3600",
  "",
].join("\n");

/**
 * For each ledger release R and each format with a release-named snapshot at
 * or before R, the latest such snapshot at /schemas/<id>/<R>.json.
 * `snapshots` maps a format id to its snapshot names and their content.
 */
export function servedSchemas<T>(
  ledger: ReleaseLedger,
  snapshots: ReadonlyMap<string, ReadonlyMap<string, T>>,
): ServedSchemas<T> {
  const files = new Map<string, T>();
  for (const release of ledger.releases) {
    for (const formatId of FORMAT_IDS) {
      const named = snapshots.get(formatId) ?? new Map<string, T>();
      const latest = [...named.keys()]
        .filter((name) => isRelease(name) && compareReleases(name, release) <= 0)
        .toSorted(compareReleases)
        .at(-1);
      const content = latest === undefined ? undefined : named.get(latest);
      if (content !== undefined) files.set(servedPath(formatId, release), content);
    }
  }
  const sorted = new Map([...files].toSorted(([left], [right]) => (left < right ? -1 : 1)));
  return {
    files: sorted,
    index: renderSchemaIndex(ledger, [...sorted.keys()]),
    headers: SCHEMA_HEADERS,
  };
}

/** /schemas/index.json for `paths`, already sorted: 2-space JSON plus a newline. */
function renderSchemaIndex(ledger: ReleaseLedger, paths: ReadonlyArray<string>): string {
  const index: SchemaIndex = {
    releases: [...ledger.releases].toSorted(compareReleases),
    paths: [...paths],
  };
  return `${JSON.stringify(index, null, 2)}\n`;
}

export interface SchemaSources {
  /** packages/schemas/releases.json as written, or undefined when missing. */
  readonly ledger: string | undefined;
  /** Format id → snapshot name → the snapshot file's bytes. */
  readonly snapshots: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  /** Retired format id → release → the frozen copy's bytes (site/retired-schemas/). */
  readonly retired: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
}

export interface PublicSchemas {
  /** Every served schema plus /schemas/index.json and /_headers, by URL path, sorted. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  /** The served schema paths, without the index and _headers. */
  readonly served: ReadonlyArray<string>;
  readonly releases: number;
  readonly formats: number;
  readonly findings: ReadonlyArray<string>;
}

/** What the site build publishes from `sources` at `packageVersion`, or every finding against it. */
export function publicSchemas(sources: SchemaSources, packageVersion: string): PublicSchemas {
  const none = { files: new Map(), served: [], releases: 0, formats: 0 };
  if (sources.ledger === undefined) {
    return { ...none, findings: [`✗ ${LEDGER_PATH}: the release ledger is missing`] };
  }
  const ledger = parseLedger(sources.ledger);
  if (ledger === undefined) {
    return {
      ...none,
      findings: [`✗ ${LEDGER_PATH}: not { "releases": ["X.Y.Z", …] }`],
    };
  }
  const names = new Map([...sources.snapshots].map(([id, named]) => [id, [...named.keys()]]));
  const findings = checkLedger(ledger, packageVersion, names);
  if (findings.length > 0) return { ...none, findings };
  const current = servedSchemas(ledger, sources.snapshots);
  const retiredFindings = checkRetired(ledger, sources.retired, current.files);
  if (retiredFindings.length > 0) return { ...none, findings: retiredFindings };
  const served = new Map(
    [
      ...current.files,
      ...[...sources.retired].flatMap(([formatId, copies]) =>
        [...copies].map(([release, content]) => [servedPath(formatId, release), content] as const),
      ),
    ].toSorted(([left], [right]) => (left < right ? -1 : 1)),
  );
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>([
    ...served,
    [SCHEMA_INDEX_PATH, encoder.encode(renderSchemaIndex(ledger, [...served.keys()]))],
    [HEADERS_PATH, encoder.encode(current.headers)],
  ]);
  return {
    files: new Map([...files].toSorted(([left], [right]) => (left < right ? -1 : 1))),
    served: [...served.keys()],
    releases: ledger.releases.length,
    formats: new Set([...current.files.keys()].map((path) => path.split("/")[2])).size,
    findings: [],
  };
}

/**
 * Every finding about the retired schemas, as `✗ …` lines: a retired id that
 * is a current format id, a retired release the ledger lacks, and a retired
 * path a current format already serves.
 */
function checkRetired(
  ledger: ReleaseLedger,
  retired: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>,
  served: ReadonlyMap<string, Uint8Array>,
): ReadonlyArray<string> {
  const findings: Array<string> = [];
  const listed = new Set(ledger.releases);
  for (const [formatId, copies] of [...retired].toSorted(([left], [right]) =>
    left < right ? -1 : 1,
  )) {
    if (isFormatId(formatId)) {
      findings.push(`✗ ${RETIRED_SCHEMAS_DIR}/${formatId}: ${formatId} is a current format id`);
    }
    for (const release of [...copies.keys()].toSorted(compareReleases)) {
      const file = `${RETIRED_SCHEMAS_DIR}/${formatId}/${release}.json`;
      if (!listed.has(release)) {
        findings.push(`✗ ${file}: release ${release} is not in the release ledger`);
      }
      if (served.has(servedPath(formatId, release))) {
        findings.push(`✗ ${file}: ${servedPath(formatId, release)} is already served`);
      }
    }
  }
  return findings;
}

/** The ledger and every snapshot under `repoRoot`, read as raw bytes. */
export function readSchemaSources(repoRoot: string): SchemaSources {
  const ledgerFile = join(repoRoot, LEDGER_PATH);
  const snapshots = new Map<string, ReadonlyMap<string, Uint8Array>>();
  const root = join(repoRoot, SNAPSHOTS_DIR);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isFormatId(entry.name)) continue;
    const named = new Map<string, Uint8Array>();
    for (const file of readdirSync(join(root, entry.name), { withFileTypes: true })) {
      const name = file.isFile() ? parseSnapshotName(file.name) : undefined;
      if (name !== undefined) named.set(name, readFileSync(join(root, entry.name, file.name)));
    }
    snapshots.set(entry.name, named);
  }
  return {
    ledger: existsSync(ledgerFile) ? readFileSync(ledgerFile, "utf8") : undefined,
    snapshots,
    retired: readRetiredSchemas(join(repoRoot, RETIRED_SCHEMAS_DIR)),
  };
}

/** Every `<format id>/<X.Y.Z>.json` under `root`, as format id → release → raw bytes. */
function readRetiredSchemas(root: string): ReadonlyMap<string, ReadonlyMap<string, Uint8Array>> {
  const retired = new Map<string, ReadonlyMap<string, Uint8Array>>();
  if (!existsSync(root)) return retired;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const copies = new Map<string, Uint8Array>();
    for (const file of readdirSync(join(root, entry.name), { withFileTypes: true })) {
      const release = file.name.endsWith(".json") ? file.name.slice(0, -".json".length) : "";
      if (file.isFile() && isRelease(release)) {
        copies.set(release, readFileSync(join(root, entry.name, file.name)));
      }
    }
    retired.set(entry.name, copies);
  }
  return retired;
}
