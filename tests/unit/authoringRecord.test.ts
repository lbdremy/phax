import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  parseAuthoringRecordManifest,
  toLatestAuthoringRecordManifest,
} from "../../packages/schemas/src/formats/recordManifests.js";
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";
import {
  decodeAuthoringRecordManifestFile,
  decodeRecordManifestFile,
  encodeAuthoringRecordManifest,
  isAuthoringRecordManifest,
  type AuthoringRecordManifest,
} from "../../src/schemas/authoringRecord.js";
import { AuthoringRecordManifestV0_17_0Schema } from "../../src/schemas/history/authoring-record-manifest/0.17.0.js";
import {
  currentSchemaUrl,
  readRecordManifestFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import { UNAVAILABLE_TOKEN_USAGE } from "../../src/schemas/runRecord.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const encodeV0_17_0 = Schema.encodeSync(AuthoringRecordManifestV0_17_0Schema);

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
  retry: "none",
  usage: UNAVAILABLE_TOKEN_USAGE,
};

// The authoring manifest as phax writes it: `$schema` first, no `version`.
const authoringManifest = withSchemaUrl("authoring-record-manifest", inMemoryAuthoringManifest);

const phaseManifest = {
  $schema: currentSchemaUrl("phase-record-manifest"),
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
          $schema: currentSchemaUrl("phase-record-manifest"),
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

describe("the authoring manifest's retry", () => {
  const FILE = "authoring/2609230835-plan-prune/record.json";

  function readError(input: unknown): string {
    const read = readRecordManifestFile(FILE, input);
    if (Either.isRight(read)) throw new Error("expected the manifest to be refused");
    return read.left.message;
  }

  it("takes exactly none or retried", () => {
    for (const retry of ["none", "retried"] as const) {
      const read = readRecordManifestFile(FILE, { ...authoringManifest, retry });
      expect(Either.isRight(read) && read.right).toEqual({ ...inMemoryAuthoringManifest, retry });
    }
  });

  it("is required at the current stamp: a manifest without it, or with another value, is refused naming retry", () => {
    const { retry: _retry, ...withoutRetry } = authoringManifest;
    expect(readError(withoutRetry)).toContain("retry");
    expect(readError({ ...authoringManifest, retry: "maybe" })).toContain("retry");
    expect(
      Either.isLeft(decodeAuthoringRecordManifestFile({ ...authoringManifest, retry: "maybe" })),
    ).toBe(true);
  });

  // The frozen 0.17.0 module names its own release, as frozen-module tests do.
  const v0_17_0 = encodeV0_17_0({
    $schema: schemaUrl("authoring-record-manifest", "0.17.0"),
    kind: "authoring",
    authoringId: "2609230835-plan-prune",
    artifact: "docs/specs/2609230835-plan-prune.md",
    artifactKind: "spec",
    shape: "skeleton",
    provider: "codex-cli",
    model: "gpt-5.5",
    effort: "high",
    outcome: "failed",
    usage: { available: false },
  });

  it("a manifest stamped 0.17.0 is read by phax and upgraded with retry none", () => {
    const { $schema: _schema, ...recorded } = v0_17_0;
    const read = readRecordManifestFile(FILE, v0_17_0);
    expect(Either.isRight(read) && read.right).toEqual({ ...recorded, retry: "none" });
    // A 0.17.0 manifest never carried a retry: one that does is not that shape.
    expect(Either.isLeft(readRecordManifestFile(FILE, { ...v0_17_0, retry: "none" }))).toBe(true);
  });

  it("a manifest stamped 0.17.0 is read by the package as its 0.17.0 shape and upgraded with retry none", () => {
    const parsed = parseAuthoringRecordManifest(v0_17_0);
    expect(parsed.ok && parsed.shape).toBe("0.17.0");
    if (!parsed.ok) return;
    const { $schema: _schema, ...recorded } = v0_17_0;
    expect(toLatestAuthoringRecordManifest(parsed.value)).toEqual({ ...recorded, retry: "none" });
  });

  it("a pre-schema manifest is upgraded with retry none, by phax and by the package", () => {
    const { $schema: _schema, retry: _retry, ...recorded } = authoringManifest;
    const preSchema = { version: 1, ...recorded };
    const read = readRecordManifestFile(FILE, preSchema);
    expect(Either.isRight(read) && read.right).toEqual({ ...recorded, retry: "none" });
    const parsed = parseAuthoringRecordManifest(preSchema);
    expect(parsed.ok && toLatestAuthoringRecordManifest(parsed.value)).toEqual({
      ...recorded,
      retry: "none",
    });
  });

  it("a manifest at the current stamp is the package's current shape and keeps its retry", () => {
    const parsed = parseAuthoringRecordManifest({ ...authoringManifest, retry: "retried" });
    expect(parsed.ok && parsed.shape).toBe(CURRENT_SHAPES["authoring-record-manifest"]);
    expect(parsed.ok && toLatestAuthoringRecordManifest(parsed.value)).toEqual({
      ...inMemoryAuthoringManifest,
      retry: "retried",
    });
  });
});
