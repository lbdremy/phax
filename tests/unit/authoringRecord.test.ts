import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeAuthoringRecordManifestFile,
  decodeRecordManifestFile,
  encodeAuthoringRecordManifest,
  isAuthoringRecordManifest,
  type AuthoringRecordManifest,
} from "../../src/schemas/authoringRecord.js";
import { withSchemaUrl } from "../../src/schemas/persisted.js";
import { PHAX_RELEASE } from "../../src/schemas/release.js";
import { UNAVAILABLE_TOKEN_USAGE } from "../../src/schemas/runRecord.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const inMemoryAuthoringManifest: AuthoringRecordManifest = {
  kind: "authoring",
  authoringId: "2609230835-plan-prune",
  artifact: "docs/specs/2609230835-plan-prune.md",
  artifactKind: "spec",
  shape: "full",
  sourceSha: "a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4a1b2c3d4",
  provider: "claude-code",
  model: "claude-opus-5-5",
  effort: "high",
  outcome: "committed",
  usage: UNAVAILABLE_TOKEN_USAGE,
};

// The authoring manifest as phax writes it: `$schema` first, no `version`.
const authoringManifest = withSchemaUrl("authoring-record-manifest", inMemoryAuthoringManifest);

const phaseManifest = {
  $schema: schemaUrl("phase-record-manifest", PHAX_RELEASE),
  runId: "headless-authoring-1786807559589",
  phaseId: "phase-07",
  shape: "skeleton",
  model: "claude-opus-5-5",
  effort: "high",
  provider: "claude-code",
  outcome: "committed",
  usage: { available: false },
  verifiedSurfaces: ["local"],
};

describe("AuthoringRecordManifestSchema", () => {
  it("round-trips a committed manifest", () => {
    const encoded = encodeAuthoringRecordManifest(authoringManifest);
    const decoded = decodeAuthoringRecordManifestFile(JSON.parse(JSON.stringify(encoded)));
    expect(Either.isRight(decoded) && decoded.right).toEqual(authoringManifest);
  });

  it("decodes a failed manifest without sourceSha", () => {
    const { sourceSha: _sourceSha, ...rest } = authoringManifest;
    const decoded = decodeAuthoringRecordManifestFile({ ...rest, outcome: "failed" });
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("rejects an unknown key", () => {
    const decoded = decodeAuthoringRecordManifestFile({ ...authoringManifest, runId: "r" });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a phase-only outcome and an unknown artifact kind", () => {
    expect(
      Either.isLeft(
        decodeAuthoringRecordManifestFile({ ...authoringManifest, outcome: "abandoned" }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        decodeAuthoringRecordManifestFile({ ...authoringManifest, artifactKind: "idea" }),
      ),
    ).toBe(true);
  });

  it("starts with $schema and carries no version", () => {
    const encoded = encodeAuthoringRecordManifest(authoringManifest);
    expect(Object.keys(encoded)[0]).toBe("$schema");
    expect(encoded).not.toHaveProperty("version");
  });

  it("rejects a version key, a missing or foreign $schema, or another kind", () => {
    expect(
      Either.isLeft(decodeAuthoringRecordManifestFile({ ...authoringManifest, version: 1 })),
    ).toBe(true);
    expect(
      Either.isLeft(
        decodeAuthoringRecordManifestFile({ ...inMemoryAuthoringManifest, version: 1 }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        decodeAuthoringRecordManifestFile({
          ...authoringManifest,
          $schema: schemaUrl("phase-record-manifest", PHAX_RELEASE),
        }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(decodeAuthoringRecordManifestFile({ ...authoringManifest, kind: "run" })),
    ).toBe(true);
  });
});

describe("RecordManifestSchema (either kind)", () => {
  it("accepts a phase manifest and an authoring manifest, and tells them apart", () => {
    const phase = decodeRecordManifestFile(phaseManifest);
    const authoring = decodeRecordManifestFile(encodeAuthoringRecordManifest(authoringManifest));

    expect(Either.isRight(phase)).toBe(true);
    expect(Either.isRight(authoring)).toBe(true);
    if (Either.isRight(phase)) expect(isAuthoringRecordManifest(phase.right)).toBe(false);
    if (Either.isRight(authoring)) expect(isAuthoringRecordManifest(authoring.right)).toBe(true);
  });

  it("rejects a mixed object", () => {
    expect(Either.isLeft(decodeRecordManifestFile({ ...phaseManifest, kind: "authoring" }))).toBe(
      true,
    );
    expect(
      Either.isLeft(decodeRecordManifestFile({ ...authoringManifest, phaseId: "phase-01" })),
    ).toBe(true);
    expect(
      Either.isLeft(decodeRecordManifestFile({ ...phaseManifest, ...authoringManifest })),
    ).toBe(true);
  });

  it("rejects a manifest without $schema", () => {
    const { $schema: _schema, ...withoutSchema } = phaseManifest;
    expect(Either.isLeft(decodeRecordManifestFile({ ...withoutSchema, version: 2 }))).toBe(true);
    expect(Either.isLeft(decodeRecordManifestFile(inMemoryAuthoringManifest))).toBe(true);
  });
});
