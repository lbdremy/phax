import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parsePhaseRecordManifest,
  toLatestPhaseRecordManifest,
  type PhaseRecordManifest,
} from "../../../packages/schemas/src/index.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { validDocuments, versionOnePhaseRecordManifest, withKey, withoutKey } from "./documents.js";

const manifest = validDocuments["phase-record-manifest"];

describe("parsePhaseRecordManifest over the pre-schema shape", () => {
  it("reads a version-2 manifest without $schema as shape pre-schema", () => {
    const result = parsePhaseRecordManifest(manifest);
    expect(result).toEqual({ ok: true, shape: "pre-schema", value: manifest });
    if (result.ok) {
      const value: PhaseRecordManifest = result.value;
      expect(value.verifiedSurfaces.length).toBeGreaterThan(0);
    }
  });

  it("fails a version-1 manifest as older than the first release that writes $schema, without throwing", () => {
    expect(() => parsePhaseRecordManifest(versionOnePhaseRecordManifest)).not.toThrow();
    const result = parsePhaseRecordManifest(versionOnePhaseRecordManifest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.error.message.startsWith(
        "phase record manifest older than the first release that writes $schema — not supported",
      ),
    ).toBe(true);
  });

  it("fails a manifest written by a newer phax, naming the release, without throwing", () => {
    // Derived from the package version, so a release bump never breaks this test.
    const release = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;
    const newer = withKey(manifest, "$schema", schemaUrl("phase-record-manifest", release));
    expect(() => parsePhaseRecordManifest(newer)).not.toThrow();
    expect(parsePhaseRecordManifest(newer)).toEqual({
      ok: false,
      error: {
        path: "$schema",
        message: `phase-record-manifest written by phax ${release} is newer than @lbdremy/phax-schemas ${PACKAGE_VERSION} — upgrade the package`,
      },
    });
  });
});

describe("toLatestPhaseRecordManifest", () => {
  it("keeps every field except version", () => {
    const result = parsePhaseRecordManifest(manifest);
    if (!result.ok) throw new Error("expected a pre-schema manifest");
    const latest = toLatestPhaseRecordManifest(result.value);
    expect(latest).toEqual(withoutKey(manifest, "version"));
    expect(latest).not.toHaveProperty("version");
  });

  it("never invents a sourceSha a phase never recorded", () => {
    const result = parsePhaseRecordManifest(withoutKey(manifest, "sourceSha"));
    if (!result.ok) throw new Error("expected a pre-schema manifest");
    expect(toLatestPhaseRecordManifest(result.value)).not.toHaveProperty("sourceSha");
  });
});
