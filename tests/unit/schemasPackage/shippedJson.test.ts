// The package ships its JSON Schemas from packages/schemas/shipped-json.json:
// the built json/ directory holds exactly one file per entry, byte for byte,
// while no format has a `next` snapshot; a format with one ships the schema
// Effect renders. The released snapshots keep the digests the corpus captured.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { judgeEquivalence } from "../../../packages/schemas/build/equivalence.js";
import { sha256 } from "../../../packages/schemas/build/generated.js";
import {
  JSON_SCHEMA_FORMATS,
  RECORD_MANIFEST_MEMBERS,
  SHIPPED_JSON_PATH,
  renderJsonSchemas,
  renderShippedJson,
  shippedJsonSchemas,
  shipsGenerated,
} from "../../../packages/schemas/build/jsonSchemas.js";
import { readCorpusDocuments } from "../../../scripts/schemas-check.js";
import {
  readNextFormats,
  readShippedSource,
  writeJsonSchemas,
} from "../../../scripts/schemas-json.js";
import {
  ANSWER_FORMATS,
  answerJsonSchema,
  type AnswerFormatId,
} from "../../../src/schemas/answerSchemas.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = readShippedSource(repoRoot);

const isAnswerFormat = (id: string): id is AnswerFormatId => Object.hasOwn(ANSWER_FORMATS, id);

function built(nextFormats: ReadonlySet<string> = source.nextFormats): string {
  const outDir = join(mkdtempSync(join(tmpdir(), "phax-shipped-json-")), "json");
  expect(writeJsonSchemas(JSON_SCHEMA_FORMATS, outDir, { ...source, nextFormats })).toEqual([]);
  return outDir;
}

describe("the shipped JSON Schemas", () => {
  it("are read from the committed shipped-json.json, which only a format born in the release being developed overrides with its next snapshot", () => {
    expect(readNextFormats(repoRoot)).toEqual(new Set(["revision-record-manifest"]));
    expect(readFileSync(join(repoRoot, SHIPPED_JSON_PATH), "utf8")).toBe(
      renderShippedJson(source.shipped),
    );
  });

  it("build to json/ entry for entry, byte for byte, one file per entry", () => {
    const outDir = built();
    const files = readdirSync(outDir).toSorted();
    expect(files).toEqual(Object.keys(source.shipped).toSorted());
    expect(files).toEqual(JSON_SCHEMA_FORMATS.map(({ fileName }) => fileName).toSorted());
    for (const file of files) {
      expect(readFileSync(join(outDir, file), "utf8"), file).toBe(source.shipped[file]);
    }
  });

  it("ship a format's generated schema while it has a next snapshot, and every other entry as it is", () => {
    const outDir = built(new Set(["registry"]));
    const generated = renderJsonSchemas(
      JSON_SCHEMA_FORMATS.filter(({ format }) => format === "registry"),
    ).files.get("registry.schema.json");
    expect(generated).toBeDefined();
    expect(readFileSync(join(outDir, "registry.schema.json"), "utf8")).toBe(generated);
    expect(readFileSync(join(outDir, "run-status.schema.json"), "utf8")).toBe(
      source.shipped["run-status.schema.json"],
    );
  });

  it("ship record-manifest's generated schema while one of its members has a next snapshot", () => {
    for (const member of RECORD_MANIFEST_MEMBERS) {
      expect(shipsGenerated("record-manifest", new Set([member])), member).toBe(true);
    }
    expect(shipsGenerated("record-manifest", new Set(["registry"]))).toBe(false);
    const { files } = shippedJsonSchemas(
      JSON_SCHEMA_FORMATS.filter(({ format }) => format === "record-manifest"),
      source.shipped,
      new Set(),
    );
    expect(files.get("record-manifest.schema.json")).toBe(
      source.shipped["record-manifest.schema.json"],
    );
  });
});

describe("the answer schemas phax hands a model", () => {
  it("are each equivalent to the format's shipped schema over its corpus documents", () => {
    const documents = readCorpusDocuments(repoRoot);
    for (const format of Object.keys(ANSWER_FORMATS).filter(isAnswerFormat)) {
      const verdict = judgeEquivalence({
        released: JSON.parse(source.shipped[`${format}.schema.json`] ?? "null"),
        generated: answerJsonSchema(format),
        documents: documents.get(format) ?? [],
      });
      expect(verdict.disagreements, format).toEqual([]);
      expect(verdict.equivalent, format).toBe(true);
    }
  });
});

describe("the released snapshots", () => {
  it("keep the digests the corpus captured", () => {
    const digests: unknown = JSON.parse(
      readFileSync(join(repoRoot, "tests/behaviourCorpus/baseline/snapshot-digests.json"), "utf8"),
    );
    if (typeof digests !== "object" || digests === null) throw new Error("no digest map");
    const entries = Object.entries(digests);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, digest] of entries) {
      expect(sha256(readFileSync(join(repoRoot, path))), path).toBe(digest);
    }
  });
});
