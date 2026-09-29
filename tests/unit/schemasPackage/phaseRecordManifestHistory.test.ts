import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  UNKNOWN,
  parsePhaseRecordManifest,
  toLatestPhaseRecordManifest,
  type PhaseRecordManifest,
  type PhaseRecordManifestShape,
  type PhaseRecordManifestV1,
} from "../../../packages/schemas/src/index.js";

const fixturesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "phase-record-manifest",
);

// Real manifests copied from the records branch, one directory per shape.
function fixtures(shape: PhaseRecordManifestShape): ReadonlyArray<readonly [string, string]> {
  const dir = join(fixturesRoot, shape);
  return readdirSync(dir)
    .toSorted()
    .map((name) => [name, readFileSync(join(dir, name), "utf8")] as const);
}

const v1 = fixtures("v1");
const v2 = fixtures("v2");

function parseFixture(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

describe("phase record manifest fixtures", () => {
  it("hold every v1 manifest and at least three v2 manifests", () => {
    expect(v1).toHaveLength(6);
    expect(v2.length).toBeGreaterThanOrEqual(3);
  });

  it.each([...v1, ...v2])(
    "%s follows the naming contract: pretty JSON, named by its sha256 prefix",
    (name, content) => {
      expect(content).toBe(`${JSON.stringify(JSON.parse(content), null, 2)}\n`);
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      expect(name).toBe(`${hash}.json`);
    },
  );
});

describe("parsePhaseRecordManifest over the real history", () => {
  it.each(v1)("reads v1 fixture %s as shape v1", (_name, content) => {
    const document = parseFixture(content);
    const result = parsePhaseRecordManifest(document);
    expect(result).toEqual({ ok: true, shape: "v1", value: document });
    if (result.ok && result.shape === "v1") {
      const value: PhaseRecordManifestV1 = result.value;
      expect(value.version).toBe(1);
    }
  });

  it.each(v2)("reads v2 fixture %s as shape v2", (_name, content) => {
    const document = parseFixture(content);
    const result = parsePhaseRecordManifest(document);
    expect(result).toEqual({ ok: true, shape: "v2", value: document });
    if (result.ok && result.shape === "v2") {
      const value: PhaseRecordManifest = result.value;
      expect(value.verifiedSurfaces.length).toBeGreaterThan(0);
    }
  });

  it("fails a manifest written by a newer phax, naming the release, without throwing", () => {
    const [[, content] = ["", "{}"]] = v2;
    // Derived from the package version, so a release bump never breaks this test.
    const release = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;
    const newer = {
      ...parseFixture(content),
      $schema: `https://docs.phax.run/schemas/phase-record-manifest/${release}.json`,
    };
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
  it.each(v1)("upgrades v1 fixture %s, marking verifiedSurfaces unknown", (_name, content) => {
    const result = parsePhaseRecordManifest(parseFixture(content));
    if (!result.ok || result.shape !== "v1") throw new Error("expected a v1 manifest");
    const latest = toLatestPhaseRecordManifest(result.value);
    const { version: _version, ...recorded } = result.value;
    expect(latest.verifiedSurfaces).toEqual({ kind: "unknown" });
    expect(latest.verifiedSurfaces).toBe(UNKNOWN);
    expect(latest).not.toHaveProperty("version");
    expect(latest).toEqual({ ...recorded, verifiedSurfaces: { kind: "unknown" } });
  });

  it.each(v2)("keeps every field of v2 fixture %s except version", (_name, content) => {
    const result = parsePhaseRecordManifest(parseFixture(content));
    if (!result.ok || result.shape !== "v2") throw new Error("expected a v2 manifest");
    const { version: _version, ...recorded } = result.value;
    expect(toLatestPhaseRecordManifest(result.value)).toEqual(recorded);
  });

  it("never invents a sourceSha a phase never recorded", () => {
    const [[, content] = ["", "{}"]] = v1;
    const { sourceSha: _sourceSha, ...withoutSha } = parseFixture(content);
    const result = parsePhaseRecordManifest(withoutSha);
    if (!result.ok || result.shape !== "v1") throw new Error("expected a v1 manifest");
    expect(toLatestPhaseRecordManifest(result.value)).not.toHaveProperty("sourceSha");
  });
});
