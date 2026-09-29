// Writes packages/schemas/json/: one draft-07 JSON Schema per persisted
// format, plus record-manifest.schema.json for the union of the two manifests.
// A format JSON Schema cannot describe faithfully fails the run, named, and
// gets no file. The root build script runs it after tsc.
// Run: pnpm exec tsx scripts/schemas-json.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
  type JsonSchemaFailure,
  type JsonSchemaFormat,
} from "../packages/schemas/build/jsonSchemas.js";

const JSON_DIR = "packages/schemas/json";

/**
 * Clears `outDir`, writes every rendered file into it, prints one `✗ …` line
 * per failed format and returns the failures.
 */
export function writeJsonSchemas(
  table: ReadonlyArray<JsonSchemaFormat>,
  outDir: string,
): ReadonlyArray<JsonSchemaFailure> {
  const { files, failures } = renderJsonSchemas(table);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [fileName, content] of files) writeFileSync(join(outDir, fileName), content);
  for (const { format, reason } of failures) console.error(`✗ ${format}: ${reason}`);
  return failures;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const failures = writeJsonSchemas(JSON_SCHEMA_FORMATS, join(repoRoot, JSON_DIR));
  if (failures.length > 0) process.exit(1);
  console.log(`Wrote ${JSON_SCHEMA_FORMATS.length} JSON Schemas to ${JSON_DIR}/`);
}
