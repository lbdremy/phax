import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseAuthoringRecordManifest,
  parseDocument,
  parseRecordManifest,
  toLatestAuthoringRecordManifest,
} from "../../../packages/schemas/src/index.js";
import {
  malformedSchemaUrlMessage,
  newerReleaseMessage,
  notAnObjectMessage,
  unknownFormatMessage,
} from "../../../packages/schemas/src/shapes.js";
import { decodeAuthoringRecordManifestFile } from "../../../src/schemas/authoringRecord.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import {
  belowOwnReleaseMessage,
  preSchemaDocuments,
  preSchemaUnsupported,
  validDocuments,
  versionOnePhaseRecordManifest,
  withKey,
  withoutKey,
} from "./documents.js";

const PHASE_CURRENT = CURRENT_SHAPES["phase-record-manifest"];
const AUTHORING_CURRENT = CURRENT_SHAPES["authoring-record-manifest"];

// As 0.16.0 wrote them: `version`, no `$schema`.
const authoring = preSchemaDocuments["authoring-record-manifest"];
const phase = preSchemaDocuments["phase-record-manifest"];
// As phax writes them now: `$schema` first, no `version`.
const writtenAuthoring = validDocuments["authoring-record-manifest"];
const writtenPhase = validDocuments["phase-record-manifest"];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

// phax has always written `sourceSha` as optional: absent when the session did not commit.
const AUTHORING = [
  ["with sourceSha", authoring],
  ["without sourceSha", withoutKey(authoring, "sourceSha")],
] as const;

describe("the authoring record manifest", () => {
  it.each(AUTHORING)("parses a manifest %s as shape pre-schema", (_label, document) => {
    expect(parseAuthoringRecordManifest(document)).toEqual({
      ok: true,
      shape: "pre-schema",
      value: document,
    });
  });

  it("parses a manifest phax writes as its current shape, with phax's value", () => {
    expect(Object.keys(writtenAuthoring)[0]).toBe("$schema");
    expect(writtenAuthoring).not.toHaveProperty("version");
    const phax = decodeAuthoringRecordManifestFile(writtenAuthoring);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(parseAuthoringRecordManifest(writtenAuthoring)).toEqual({
      ok: true,
      shape: AUTHORING_CURRENT,
      value: phax.right,
    });
  });

  it("upgrades both shapes to the same value, keeping kind authoring", () => {
    const before = parseAuthoringRecordManifest(authoring);
    const after = parseAuthoringRecordManifest(writtenAuthoring);
    if (!before.ok || !after.ok) throw new Error("expected both manifests to parse");
    const latest = toLatestAuthoringRecordManifest(after.value);
    expect(latest).toEqual(toLatestAuthoringRecordManifest(before.value));
    expect(latest).not.toHaveProperty("$schema");
    expect(latest.kind).toBe("authoring");
  });

  it.each(AUTHORING)(
    "upgrades a manifest %s by dropping version, never adding sourceSha",
    (_label, document) => {
      const result = parseAuthoringRecordManifest(document);
      if (!result.ok) throw new Error("document rejected");
      const latest = toLatestAuthoringRecordManifest(result.value);
      expect(latest).toEqual(withoutKey(document, "version"));
      expect(Object.hasOwn(latest, "version")).toBe(false);
      expect(Object.hasOwn(latest, "sourceSha")).toBe(Object.hasOwn(document, "sourceSha"));
    },
  );

  it("fails a document written by a newer release with the upgrade message", () => {
    const document = withKey(
      authoring,
      "$schema",
      schemaUrl("authoring-record-manifest", NEWER_RELEASE),
    );
    const failure = {
      ok: false,
      error: {
        path: "$schema",
        message: newerReleaseMessage("authoring-record-manifest", NEWER_RELEASE, PACKAGE_VERSION),
      },
    };
    expect(parseAuthoringRecordManifest(document)).toEqual(failure);
    expect(parseDocument(document)).toEqual(failure);
    expect(parseRecordManifest(document)).toEqual(failure);
  });
});

describe("parseRecordManifest", () => {
  it("reads an authoring manifest as an authoring record manifest", () => {
    expect(parseRecordManifest(authoring)).toEqual({
      ok: true,
      format: "authoring-record-manifest",
      shape: "pre-schema",
      value: authoring,
    });
  });

  it("reads a phase manifest as a phase record manifest", () => {
    expect(parseRecordManifest(phase)).toEqual({
      ok: true,
      format: "phase-record-manifest",
      shape: "pre-schema",
      value: phase,
    });
  });

  it("reads the manifests phax writes by their $schema, as their current shapes", () => {
    expect(parseRecordManifest(writtenPhase)).toEqual({
      ok: true,
      format: "phase-record-manifest",
      shape: PHASE_CURRENT,
      value: writtenPhase,
    });
    expect(parseRecordManifest(writtenAuthoring)).toEqual({
      ok: true,
      format: "authoring-record-manifest",
      shape: AUTHORING_CURRENT,
      value: writtenAuthoring,
    });
  });

  it("identifies a manifest phax writes from its content alone (ac-identify-alone)", () => {
    expect(parseDocument(writtenPhase)).toMatchObject({
      ok: true,
      format: "phase-record-manifest",
      shape: PHASE_CURRENT,
    });
    expect(parseDocument(writtenAuthoring)).toMatchObject({
      ok: true,
      format: "authoring-record-manifest",
      shape: AUTHORING_CURRENT,
    });
  });

  it("fails a version-1 phase manifest as older than the first supported release", () => {
    const result = parseRecordManifest(versionOnePhaseRecordManifest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.startsWith(preSchemaUnsupported("phase record manifest"))).toBe(
        true,
      );
    }
  });

  it("dispatches on $schema before kind", () => {
    // A phase $schema sends an authoring document to the phase record manifest,
    // which reads no shape at that release: kind is never consulted.
    const document = withKey(authoring, "$schema", schemaUrl("phase-record-manifest", "0.1.0"));
    expect(parseRecordManifest(document)).toEqual({
      ok: false,
      error: {
        path: "$schema",
        message: belowOwnReleaseMessage("phase-record-manifest", "0.1.0"),
      },
    });
  });

  it("dispatches on $schema before kind at the package's own release: phax's phase decoder reads it", () => {
    // The authoring manifest phax writes, under a phase $schema: the phase
    // decoder rejects its kind and names only phase keys.
    const document = withKey(
      writtenAuthoring,
      "$schema",
      schemaUrl("phase-record-manifest", PACKAGE_VERSION),
    );
    const result = parseRecordManifest(document);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("kind");
    expect(result.error.message).toMatch(/^is unexpected, expected: .*"runId" \| "phaseId"/);
  });

  it("fails a document of another format, naming its URL", () => {
    const url = schemaUrl("registry", PACKAGE_VERSION);
    expect(parseRecordManifest({ $schema: url, version: 1, runs: [] })).toEqual({
      ok: false,
      error: { path: "$schema", message: `${url} is a registry document, not a record manifest` },
    });
  });

  it("fails a malformed $schema and an unknown format with the shared messages", () => {
    expect(parseRecordManifest({ $schema: "record.json" })).toEqual({
      ok: false,
      error: { path: "$schema", message: malformedSchemaUrlMessage("record.json") },
    });
    const unknown = "https://docs.phax.run/schemas/code-review/0.16.0.json";
    expect(parseRecordManifest({ $schema: unknown })).toEqual({
      ok: false,
      error: { path: "$schema", message: unknownFormatMessage(unknown, PACKAGE_VERSION) },
    });
  });

  it("fails a non-object at the root", () => {
    for (const input of [null, "record.json", 1, [authoring]]) {
      expect(parseRecordManifest(input)).toEqual({
        ok: false,
        error: { path: "", message: notAnObjectMessage("record manifest", input) },
      });
    }
  });

  it("reads a kind-less document as a phase record manifest, with its failure", () => {
    const result = parseRecordManifest(withoutKey(authoring, "kind"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).not.toBe("kind");
  });

  it("never throws", () => {
    const inputs: ReadonlyArray<unknown> = [
      undefined,
      {},
      { kind: "authoring" },
      { $schema: 1 },
      { version: "1" },
      Object.create(null),
      withKey(authoring, "usage", null),
    ];
    for (const input of inputs) {
      expect(() => parseRecordManifest(input)).not.toThrow();
      expect(parseRecordManifest(input).ok).toBe(false);
    }
  });
});
