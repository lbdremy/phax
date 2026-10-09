import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parsePhaseRecordManifest,
  toLatestPhaseRecordManifest,
  type PhaseRecordManifest,
} from "../../../packages/schemas/src/index.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import {
  preSchemaDocuments,
  preSchemaUnsupported,
  validDocuments,
  versionOnePhaseRecordManifest,
  withKey,
  withoutKey,
} from "./documents.js";

const preSchema = preSchemaDocuments["phase-record-manifest"];
const written = validDocuments["phase-record-manifest"];
const CURRENT = CURRENT_SHAPES["phase-record-manifest"];

describe("parsePhaseRecordManifest across shapes (ac-history-read)", () => {
  it("reads a version-2 manifest without $schema as shape pre-schema", () => {
    const result = parsePhaseRecordManifest(preSchema);
    expect(result).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("reads a manifest phax writes, with $schema first, as its current shape", () => {
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written).not.toHaveProperty("version");
    const result = parsePhaseRecordManifest(written);
    expect(result).toEqual({ ok: true, shape: CURRENT, value: written });
    if (result.ok && result.shape === CURRENT) {
      const value: PhaseRecordManifest = result.value;
      expect(value.verifiedSurfaces.length).toBeGreaterThan(0);
    }
  });

  it("fails a version-1 manifest as older than the first supported release, without throwing", () => {
    expect(() => parsePhaseRecordManifest(versionOnePhaseRecordManifest)).not.toThrow();
    const result = parsePhaseRecordManifest(versionOnePhaseRecordManifest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message.startsWith(preSchemaUnsupported("phase record manifest"))).toBe(
      true,
    );
  });

  it("fails a manifest written by a newer phax, naming the release, without throwing", () => {
    // Derived from the package version, so a release bump never breaks this test.
    const release = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;
    const newer = withKey(written, "$schema", schemaUrl("phase-record-manifest", release));
    expect(() => parsePhaseRecordManifest(newer)).not.toThrow();
    expect(parsePhaseRecordManifest(newer)).toEqual({
      ok: false,
      error: {
        path: "$schema",
        message: `phase-record-manifest ${release} is newer than @lbdremy/phax-schemas ${PACKAGE_VERSION} — upgrade the package`,
      },
    });
  });
});

describe("toLatestPhaseRecordManifest (ac-to-latest)", () => {
  it("keeps every field of a pre-schema manifest except version", () => {
    const result = parsePhaseRecordManifest(preSchema);
    if (!result.ok) throw new Error("expected a pre-schema manifest");
    const latest = toLatestPhaseRecordManifest(result.value);
    expect(latest).toEqual(withoutKey(preSchema, "version"));
    expect(latest).not.toHaveProperty("version");
  });

  it("gives the same value for the pre-schema manifest and the one phax writes", () => {
    const before = parsePhaseRecordManifest(preSchema);
    const after = parsePhaseRecordManifest(written);
    if (!before.ok || !after.ok) throw new Error("expected both manifests to parse");
    const latest = toLatestPhaseRecordManifest(after.value);
    expect(latest).toEqual(toLatestPhaseRecordManifest(before.value));
    expect(latest).not.toHaveProperty("$schema");
  });

  it("never invents a sourceSha a phase never recorded", () => {
    const result = parsePhaseRecordManifest(withoutKey(preSchema, "sourceSha"));
    if (!result.ok) throw new Error("expected a pre-schema manifest");
    expect(toLatestPhaseRecordManifest(result.value)).not.toHaveProperty("sourceSha");
  });
});
