import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeAuthoringRecordManifest,
  decodeRecordManifest,
  encodeAuthoringRecordManifest,
  isAuthoringRecordManifest,
  type AuthoringRecordManifest,
} from "../../src/schemas/authoringRecord.js";
import { UNAVAILABLE_TOKEN_USAGE } from "../../src/schemas/runRecord.js";

const authoringManifest: AuthoringRecordManifest = {
  version: 1,
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

const phaseManifest = {
  version: 2,
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
    const decoded = decodeAuthoringRecordManifest(JSON.parse(JSON.stringify(encoded)));
    expect(Either.isRight(decoded) && decoded.right).toEqual(authoringManifest);
  });

  it("decodes a failed manifest without sourceSha", () => {
    const { sourceSha: _sourceSha, ...rest } = authoringManifest;
    const decoded = decodeAuthoringRecordManifest({ ...rest, outcome: "failed" });
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("rejects an unknown key", () => {
    const decoded = decodeAuthoringRecordManifest({ ...authoringManifest, runId: "r" });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a phase-only outcome and an unknown artifact kind", () => {
    expect(
      Either.isLeft(decodeAuthoringRecordManifest({ ...authoringManifest, outcome: "abandoned" })),
    ).toBe(true);
    expect(
      Either.isLeft(decodeAuthoringRecordManifest({ ...authoringManifest, artifactKind: "idea" })),
    ).toBe(true);
  });

  it("rejects another version or kind", () => {
    expect(Either.isLeft(decodeAuthoringRecordManifest({ ...authoringManifest, version: 2 }))).toBe(
      true,
    );
    expect(
      Either.isLeft(decodeAuthoringRecordManifest({ ...authoringManifest, kind: "run" })),
    ).toBe(true);
  });
});

describe("RecordManifestSchema (either kind)", () => {
  it("accepts a phase manifest and an authoring manifest, and tells them apart", () => {
    const phase = decodeRecordManifest(phaseManifest);
    const authoring = decodeRecordManifest(encodeAuthoringRecordManifest(authoringManifest));

    expect(Either.isRight(phase)).toBe(true);
    expect(Either.isRight(authoring)).toBe(true);
    if (Either.isRight(phase)) expect(isAuthoringRecordManifest(phase.right)).toBe(false);
    if (Either.isRight(authoring)) expect(isAuthoringRecordManifest(authoring.right)).toBe(true);
  });

  it("rejects a mixed object", () => {
    expect(Either.isLeft(decodeRecordManifest({ ...phaseManifest, kind: "authoring" }))).toBe(true);
    expect(Either.isLeft(decodeRecordManifest({ ...authoringManifest, phaseId: "phase-01" }))).toBe(
      true,
    );
    expect(Either.isLeft(decodeRecordManifest({ ...phaseManifest, ...authoringManifest }))).toBe(
      true,
    );
  });
});
