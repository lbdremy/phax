import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as entry from "../../../packages/schemas/src/index.js";

const packageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "schemas",
);

describe("schemas package entry", () => {
  it("exports exactly parseDocument, the phase record manifest's schema, parse and upgrade, and the unknown marker at runtime", () => {
    expect(Object.keys(entry).toSorted()).toEqual([
      "PhaseRecordManifestSchema",
      "UNKNOWN",
      "isUnknown",
      "parseDocument",
      "parsePhaseRecordManifest",
      "toLatestPhaseRecordManifest",
    ]);
  });

  it("is the only subpath in the package manifest's exports", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      exports: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports)).toEqual(["."]);
  });
});
