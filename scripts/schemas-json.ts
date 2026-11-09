// Writes packages/schemas/json/: one draft-07 JSON Schema per persisted
// format, plus record-manifest.schema.json for the union of the manifests.
// The build ships packages/schemas/shipped-json.json verbatim: every format
// without a `next` snapshot keeps the exact bytes it shipped. A format with a
// `next` snapshot (for record-manifest, one of its members) ships its schema
// as Effect renders it, and `--write` of scripts/schemas-check.ts copies that
// into shipped-json.json. A rendered format JSON Schema cannot describe
// faithfully fails the run, named, and gets no file. The root build script
// runs it after tsc.
// Run: pnpm exec tsx scripts/schemas-json.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JSON_SCHEMA_FORMATS,
  SHIPPED_JSON_PATH,
  parseShippedJson,
  renderJsonSchemas,
  shippedJsonSchemas,
  type JsonSchemaFailure,
  type JsonSchemaFormat,
  type ShippedJson,
} from "../packages/schemas/build/jsonSchemas.js";
import { SNAPSHOTS_DIR, snapshotPath } from "../packages/schemas/build/snapshots.js";

const JSON_DIR = "packages/schemas/json";

/** The frozen copy the build ships from, and the formats that ship their generated schema instead. */
export interface ShippedSource {
  readonly shipped: ShippedJson;
  /** Format ids with a `next` snapshot. */
  readonly nextFormats: ReadonlySet<string>;
}

/**
 * Clears `outDir`, writes every file into it, prints one `✗ …` line per
 * failed format and returns the failures. Without `source`, every file is
 * rendered; with it, each is shipped as `shippedJsonSchemas` says.
 */
export function writeJsonSchemas(
  table: ReadonlyArray<JsonSchemaFormat>,
  outDir: string,
  source?: ShippedSource,
): ReadonlyArray<JsonSchemaFailure> {
  const { files, failures } =
    source === undefined
      ? renderJsonSchemas(table)
      : shippedJsonSchemas(table, source.shipped, source.nextFormats);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [fileName, content] of files) writeFileSync(join(outDir, fileName), content);
  for (const { format, reason } of failures) console.error(`✗ ${format}: ${reason}`);
  return failures;
}

/** The format directories under `SNAPSHOTS_DIR` that hold a `next` snapshot. */
export function readNextFormats(repoRoot: string): ReadonlySet<string> {
  const root = join(repoRoot, SNAPSHOTS_DIR);
  if (!existsSync(root)) return new Set();
  return new Set(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((id) => existsSync(join(repoRoot, snapshotPath(id, "next")))),
  );
}

/** Reads `shipped-json.json` and the `next` snapshots of the tree at `repoRoot`. */
export function readShippedSource(repoRoot: string): ShippedSource {
  const shipped = parseShippedJson(readFileSync(join(repoRoot, SHIPPED_JSON_PATH), "utf8"));
  if (typeof shipped === "string") throw new Error(`${SHIPPED_JSON_PATH}: ${shipped}`);
  return { shipped, nextFormats: readNextFormats(repoRoot) };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const failures = writeJsonSchemas(
    JSON_SCHEMA_FORMATS,
    join(repoRoot, JSON_DIR),
    readShippedSource(repoRoot),
  );
  if (failures.length > 0) process.exit(1);
  console.log(`Wrote ${JSON_SCHEMA_FORMATS.length} JSON Schemas to ${JSON_DIR}/`);
}
