import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either, JSONSchema } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  AuthoringRecordManifestV1Schema,
  decodeAuthoringRecordManifestV1,
} from "../../../packages/schemas/src/history/authoring-record-manifest/v1.js";
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
import {
  AuthoringRecordManifestSchema,
  decodeAuthoringRecordManifest,
} from "../../../src/schemas/authoringRecord.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { keySignature, readSurveyedFixtures, surveyGroups } from "./surveyedFixtures.js";

const fixtures = readSurveyedFixtures("authoring-record-manifest", "v1");

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

const phaseFixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "phase-record-manifest",
);
const phaseFixtures = ["v1", "v2"].flatMap((shape) =>
  readdirSync(join(phaseFixturesDir, shape)).map(
    (name) =>
      [
        `${shape}/${name}`,
        shape,
        JSON.parse(readFileSync(join(phaseFixturesDir, shape, name), "utf8")) as unknown,
      ] as const,
  ),
);

function authoringFixture(): Readonly<Record<string, unknown>> {
  const [first] = fixtures;
  if (first === undefined) throw new Error("no authoring fixture");
  return first.document as Readonly<Record<string, unknown>>;
}

describe("the authoring record manifest", () => {
  it("has one real document per surveyed signature, keyed by that signature", () => {
    expect(fixtures.map(({ signature }) => signature).toSorted()).toEqual(
      surveyGroups("authoring-record-manifest")
        .map(({ keys }) => keys)
        .toSorted(),
    );
    for (const { signature, document } of fixtures) expect(keySignature(document)).toBe(signature);
  });

  it("gets phax's verdict on each fixture: every surveyed group was accepted", () => {
    for (const group of surveyGroups("authoring-record-manifest")) {
      expect(group.rejected, group.keys).toBe(0);
    }
    for (const { signature, document } of fixtures) {
      expect(Either.isRight(decodeAuthoringRecordManifest(document)), signature).toBe(true);
    }
  });

  it("parses both legacy shapes, with and without sourceSha, as shape v1 with phax's value", () => {
    const withSourceSha = fixtures.filter(({ document }) =>
      Object.hasOwn(document as object, "sourceSha"),
    );
    expect(withSourceSha).toHaveLength(1);
    for (const { signature, document } of fixtures) {
      const phax = decodeAuthoringRecordManifest(document);
      if (Either.isLeft(phax)) throw new Error("fixture rejected by phax");
      expect(parseAuthoringRecordManifest(document), signature).toEqual({
        ok: true,
        shape: "v1",
        value: phax.right,
      });
    }
  });

  it("has a frozen v1 twin that gives phax's value on every fixture", () => {
    for (const { signature, document } of fixtures) {
      const frozen = decodeAuthoringRecordManifestV1(document);
      const phax = decodeAuthoringRecordManifest(document);
      expect(Either.isRight(frozen), signature).toBe(true);
      if (Either.isRight(frozen) && Either.isRight(phax)) {
        expect(frozen.right, signature).toEqual(phax.right);
      }
    }
  });

  it("has a frozen v1 twin with the same JSON Schema as phax's", () => {
    expect(JSONSchema.make(AuthoringRecordManifestV1Schema)).toEqual(
      JSONSchema.make(AuthoringRecordManifestSchema),
    );
  });

  it("upgrades by dropping version, keeping every field and never adding sourceSha", () => {
    for (const { signature, document } of fixtures) {
      const result = parseAuthoringRecordManifest(document);
      if (!result.ok) throw new Error("fixture rejected");
      const { version: _version, ...recorded } = result.value;
      const latest = toLatestAuthoringRecordManifest(result.value);
      expect(latest, signature).toEqual(recorded);
      expect(Object.hasOwn(latest, "version"), signature).toBe(false);
      expect(Object.hasOwn(latest, "sourceSha"), signature).toBe(
        Object.hasOwn(result.value, "sourceSha"),
      );
    }
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const document = {
      ...authoringFixture(),
      $schema: schemaUrl("authoring-record-manifest", NEWER_RELEASE),
    };
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
  it("reads each authoring fixture as an authoring record manifest", () => {
    for (const { signature, document } of fixtures) {
      expect(parseRecordManifest(document), signature).toMatchObject({
        ok: true,
        format: "authoring-record-manifest",
        shape: "v1",
        value: document,
      });
    }
  });

  it.each(phaseFixtures)(
    "reads the phase fixture %s as a phase record manifest of its shape",
    (_name, shape, document) => {
      expect(parseRecordManifest(document)).toEqual({
        ok: true,
        format: "phase-record-manifest",
        shape,
        value: document,
      });
    },
  );

  it("dispatches on $schema before kind", () => {
    // A phase $schema sends an authoring document to the phase record manifest,
    // which knows no release shape yet: kind is never consulted.
    const document = {
      ...authoringFixture(),
      $schema: schemaUrl("phase-record-manifest", PACKAGE_VERSION),
    };
    expect(parseRecordManifest(document)).toEqual({
      ok: false,
      error: {
        path: "$schema",
        message: `no phase-record-manifest shape is known at release ${PACKAGE_VERSION}`,
      },
    });
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
    for (const input of [null, "record.json", 1, [authoringFixture()]]) {
      expect(parseRecordManifest(input)).toEqual({
        ok: false,
        error: { path: "", message: notAnObjectMessage("record manifest", input) },
      });
    }
  });

  it("reads a kind-less document as a phase record manifest, with its failure", () => {
    const { kind: _kind, ...kindless } = authoringFixture();
    const result = parseRecordManifest(kindless);
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
      { ...authoringFixture(), usage: null },
    ];
    for (const input of inputs) {
      expect(() => parseRecordManifest(input)).not.toThrow();
      expect(parseRecordManifest(input).ok).toBe(false);
    }
  });
});
