import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv } from "ajv";
import { Either, JSONSchema, type ParseResult, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JSON_SCHEMA_FORMATS,
  findJsonSchemaGaps,
  renderJsonSchemas,
  type JsonSchemaFormat,
} from "../../../packages/schemas/build/jsonSchemas.js";
import {
  briefRecordFormat,
  briefRequestFormat,
} from "../../../packages/schemas/src/formats/brief.js";
import {
  authoringRecordManifestFormat,
  phaseRecordManifestFormat,
} from "../../../packages/schemas/src/formats/recordManifests.js";
import {
  gateAttributionFormat,
  gateRequestFormat,
  phaseFileReconciliationFormat,
} from "../../../packages/schemas/src/formats/recordTimeline.js";
import {
  planApprovalRecordFormat,
  planApprovalsFormat,
  planDocumentFormat,
  specApprovalRecordFormat,
  specApprovalsFormat,
  specDocumentFormat,
} from "../../../packages/schemas/src/formats/repository.js";
import {
  briefReportFormat,
  gateReportFormat,
} from "../../../packages/schemas/src/formats/reports.js";
import {
  complianceReviewFormat,
  phaseStatusFormat,
  phaxPlanFormat,
  registryFormat,
  runStatusFormat,
} from "../../../packages/schemas/src/formats/runDirectory.js";
import { CURRENT_SHAPES } from "../../../packages/schemas/src/generated/index.js";
import { writeJsonSchemas } from "../../../scripts/schemas-json.js";
import { BranchNameSchema } from "../../../src/domain/branded.js";
import { decodeRecordManifestFile } from "../../../src/schemas/authoringRecord.js";
import { FORMAT_IDS, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { getPlanDocumentJsonSchema } from "../../../src/schemas/planDocument.js";
import {
  SpecDocumentFileSchema,
  getSpecDocumentJsonSchema,
} from "../../../src/schemas/specDocument.js";
import { validDocuments, withoutKey } from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type JsonSchemaFormatId = FormatId | "record-manifest";

const phaseManifest = validDocuments["phase-record-manifest"];
const authoringManifest = validDocuments["authoring-record-manifest"];

/** The test documents of each file, before phax's verdict. */
function documentsOf(format: JsonSchemaFormatId): ReadonlyArray<unknown> {
  switch (format) {
    case "phase-record-manifest":
      return [phaseManifest, withoutKey(phaseManifest, "sourceSha")];
    case "authoring-record-manifest":
      return [authoringManifest, withoutKey(authoringManifest, "sourceSha")];
    case "record-manifest":
      return [phaseManifest, authoringManifest];
    default:
      return [validDocuments[format]];
  }
}

/** phax's own current decoder for each file. */
const DECODERS: { readonly [F in JsonSchemaFormatId]: Decode } = {
  registry: registryFormat.current.shape.decode,
  "run-status": runStatusFormat.current.shape.decode,
  "phase-status": phaseStatusFormat.current.shape.decode,
  "phax-plan": phaxPlanFormat.current.shape.decode,
  "compliance-review": complianceReviewFormat.current.shape.decode,
  "plan-approvals": planApprovalsFormat.current.shape.decode,
  "spec-approvals": specApprovalsFormat.current.shape.decode,
  "phase-record-manifest": phaseRecordManifestFormat.current.shape.decode,
  "authoring-record-manifest": authoringRecordManifestFormat.current.shape.decode,
  "gate-attribution": gateAttributionFormat.current.shape.decode,
  "phase-file-reconciliation": phaseFileReconciliationFormat.current.shape.decode,
  "spec-document": specDocumentFormat.current.shape.decode,
  "plan-document": planDocumentFormat.current.shape.decode,
  "plan-approval-record": planApprovalRecordFormat.current.shape.decode,
  "spec-approval-record": specApprovalRecordFormat.current.shape.decode,
  "gate-request": gateRequestFormat.current.shape.decode,
  "brief-request": briefRequestFormat.current.shape.decode,
  "brief-record": briefRecordFormat.current.shape.decode,
  "gate-report": gateReportFormat.current.shape.decode,
  "brief-report": briefReportFormat.current.shape.decode,
  "record-manifest": decodeRecordManifestFile,
};

const rendered = renderJsonSchemas(JSON_SCHEMA_FORMATS);

function renderedSchema(entry: JsonSchemaFormat): Record<string, unknown> {
  const content = rendered.files.get(entry.fileName);
  if (content === undefined) throw new Error(`no file for ${entry.format}`);
  return JSON.parse(content) as Record<string, unknown>;
}

function withoutTitle(schema: object): object {
  const { title: _title, ...rest } = schema as Record<string, unknown>;
  return rest;
}

function acceptedDocuments(entry: JsonSchemaFormat): unknown[] {
  const format = entry.format as JsonSchemaFormatId;
  return documentsOf(format).filter((document) => Either.isRight(DECODERS[format](document)));
}

describe("the JSON Schema table", () => {
  it("has one entry per format id, then the record-manifest union", () => {
    expect(JSON_SCHEMA_FORMATS.map(({ format }) => format)).toEqual([
      ...FORMAT_IDS,
      "record-manifest",
    ]);
  });

  it("names each file after its format, uniquely", () => {
    const names = JSON_SCHEMA_FORMATS.map(({ fileName }) => fileName);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of JSON_SCHEMA_FORMATS) {
      expect(entry.fileName).toBe(`${entry.format}.schema.json`);
      expect(entry.title).toMatch(/^phax [a-z]/);
    }
  });

  it("renders the schema each format's parse function decodes with", () => {
    const definitions = [
      registryFormat,
      runStatusFormat,
      phaseStatusFormat,
      phaxPlanFormat,
      complianceReviewFormat,
      planApprovalsFormat,
      specApprovalsFormat,
      phaseRecordManifestFormat,
      authoringRecordManifestFormat,
      gateAttributionFormat,
      phaseFileReconciliationFormat,
      specDocumentFormat,
      planDocumentFormat,
      planApprovalRecordFormat,
      specApprovalRecordFormat,
      briefRequestFormat,
      briefRecordFormat,
      gateReportFormat,
      briefReportFormat,
    ];
    for (const definition of definitions) {
      const entry = JSON_SCHEMA_FORMATS.find(({ format }) => format === definition.id);
      expect(entry?.schema, definition.id).toBe(definition.current.shape.schema);
      expect(entry?.title).toBe(`phax ${definition.label}`);
    }
  });

  it("allows extra properties exactly for the formats whose decoder ignores them", () => {
    expect(
      JSON_SCHEMA_FORMATS.filter(({ excess }) => excess === "ignore").map(({ format }) => format),
    ).toEqual([
      "registry",
      "run-status",
      "phase-status",
      "gate-attribution",
      "phase-file-reconciliation",
    ]);
  });
});

describe("renderJsonSchemas over the real table", () => {
  it("renders 21 files and no failure", () => {
    expect(rendered.failures).toEqual([]);
    expect([...rendered.files.keys()]).toEqual(JSON_SCHEMA_FORMATS.map(({ fileName }) => fileName));
    expect(rendered.files.size).toBe(21);
  });

  it.each(JSON_SCHEMA_FORMATS)(
    "$format: a draft-07 schema titled from the table, as 2-space JSON",
    (entry) => {
      const content = rendered.files.get(entry.fileName) ?? "";
      const schema = renderedSchema(entry);
      expect(schema["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
      expect(schema["title"]).toBe(entry.title);
      expect(content).toBe(`${JSON.stringify(schema, null, 2)}\n`);
    },
  );

  it.each(JSON_SCHEMA_FORMATS.filter(({ excess }) => excess === "error"))(
    "$format: equals JSONSchema.make of its schema, apart from the title",
    (entry) => {
      expect(withoutTitle(renderedSchema(entry))).toEqual(
        withoutTitle(JSONSchema.make(entry.schema)),
      );
    },
  );

  it("renders the spec document's file schema, with its traceability description", () => {
    const entry = JSON_SCHEMA_FORMATS.find(({ format }) => format === "spec-document");
    if (entry === undefined) throw new Error("no spec-document entry");
    const schema = renderedSchema(entry);
    expect(schema["title"]).toBe("phax spec document");
    expect(withoutTitle(schema)).toEqual(withoutTitle(JSONSchema.make(SpecDocumentFileSchema)));
    expect(schema["description"]).toContain("`refs` entry names an existing requirement");
  });

  // The authoring contract never gains $schema: `phax artifact schema spec`
  // and the authoring prompt still print the shape 0.16.0 printed.
  it("keeps the spec-document authoring contract equal to its pre-schema snapshot, apart from the title", () => {
    expect(withoutTitle(getSpecDocumentJsonSchema())).toEqual(
      withoutTitle(readSnapshot("spec-document", "pre-schema")),
    );
  });

  // The plan document's contract gained completesSpec with its file shape, and
  // still carries `version` where the file carries `$schema`.
  it("keeps the plan-document authoring contract equal to its current file snapshot, with version for $schema", () => {
    const file = readSnapshot("plan-document", CURRENT_SHAPES["plan-document"]) as {
      readonly required: ReadonlyArray<string>;
      readonly properties: Readonly<Record<string, unknown>>;
    };
    const { $schema: _url, ...properties } = file.properties;
    const expected = {
      ...file,
      required: ["version", ...file.required.filter((key) => key !== "$schema")],
      properties: { version: { type: "number", enum: [1] }, ...properties },
    };
    expect(withoutTitle(getPlanDocumentJsonSchema())).toEqual(withoutTitle(expected));
  });
});

function readSnapshot(id: string, name: string): object {
  return JSON.parse(
    readFileSync(
      join(import.meta.dirname, `../../../packages/schemas/snapshots/${id}/${name}.schema.json`),
      "utf8",
    ),
  );
}

const isEven = (n: number) => n % 2 === 0;

describe("findJsonSchemaGaps", () => {
  it("finds nothing in the real schemas", () => {
    for (const entry of JSON_SCHEMA_FORMATS) {
      expect(findJsonSchemaGaps(entry.schema), entry.format).toEqual([]);
    }
  });

  it("returns the path of a filter without a jsonSchema annotation", () => {
    const Toy = Schema.Struct({
      a: Schema.Array(Schema.Struct({ n: Schema.Number.pipe(Schema.filter(isEven)) })),
      b: Schema.Record({ key: Schema.String, value: Schema.Number.pipe(Schema.filter(isEven)) }),
    });
    expect(findJsonSchemaGaps(Toy)).toEqual(["a[].n", "b.*"]);
  });

  it("names a filter on the root as (root)", () => {
    const Toy = Schema.Struct({ n: Schema.Number }).pipe(Schema.filter(({ n }) => isEven(n)));
    expect(findJsonSchemaGaps(Toy)).toEqual(["(root)"]);
  });

  it("does not flag a brand-only refinement, an annotated filter or effect's built-ins", () => {
    const Toy = Schema.Struct({
      id: Schema.String.pipe(Schema.brand("Id")),
      even: Schema.Number.pipe(Schema.filter(isEven, { jsonSchema: { multipleOf: 2 } })),
      count: Schema.Number.pipe(Schema.int(), Schema.positive()),
      name: Schema.String.pipe(Schema.minLength(1), Schema.pattern(/^[a-z]+$/)),
      branch: BranchNameSchema,
    });
    expect(findJsonSchemaGaps(Toy)).toEqual([]);
  });

  it("follows a suspended schema once, and terminates on a recursive one", () => {
    interface Tree {
      readonly n: number;
      readonly children: ReadonlyArray<Tree>;
    }
    const Tree: Schema.Schema<Tree> = Schema.Struct({
      n: Schema.Number.pipe(Schema.filter(isEven)),
      children: Schema.Array(Schema.suspend(() => Tree)),
    });
    expect(findJsonSchemaGaps(Tree)).toEqual(["n", "children[].n"]);
  });
});

const cleanEntry: JsonSchemaFormat = {
  format: "toy-clean",
  fileName: "toy-clean.schema.json",
  title: "phax toy",
  schema: Schema.Struct({ a: Schema.String }),
  excess: "error",
};
const gapEntry: JsonSchemaFormat = {
  format: "toy-gap",
  fileName: "toy-gap.schema.json",
  title: "phax toy with a gap",
  schema: Schema.Struct({ n: Schema.Number.pipe(Schema.filter((n) => n > 1)) }),
  excess: "error",
};

describe("renderJsonSchemas", () => {
  it("fails a format JSONSchema.make throws on, naming it, and writes no file for it", () => {
    const throwing: JsonSchemaFormat = {
      ...cleanEntry,
      format: "toy-throws",
      fileName: "toy-throws.schema.json",
      schema: Schema.Struct({ at: Schema.DateFromSelf }),
    };
    const { files, failures } = renderJsonSchemas([throwing, cleanEntry]);
    expect(failures.map(({ format }) => format)).toEqual(["toy-throws"]);
    expect(failures[0]?.reason).not.toBe("");
    expect([...files.keys()]).toEqual(["toy-clean.schema.json"]);
  });

  it("allows extra properties throughout an ignore entry, and forbids them in an error entry", () => {
    const Nested = Schema.Struct({ inner: Schema.Struct({ a: Schema.String }) });
    const { files } = renderJsonSchemas([
      { ...cleanEntry, schema: Nested, excess: "ignore" },
      { ...gapEntry, fileName: "strict.schema.json", schema: Nested },
    ]);
    const allow = JSON.parse(files.get("toy-clean.schema.json") ?? "{}") as {
      additionalProperties: unknown;
      properties: { inner: { additionalProperties: unknown } };
    };
    const strict = JSON.parse(files.get("strict.schema.json") ?? "{}") as typeof allow;
    expect(allow.additionalProperties).toBe(true);
    expect(allow.properties.inner.additionalProperties).toBe(true);
    expect(strict.additionalProperties).toBe(false);
    expect(strict.properties.inner.additionalProperties).toBe(false);
  });
});

describe("writeJsonSchemas: a format without a JSON Schema fails the build", () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      errors.push(line);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one failure naming the format, writes the clean file and none for the failing one", () => {
    const outDir = join(mkdtempSync(join(tmpdir(), "phax-schemas-json-")), "json");
    const failures = writeJsonSchemas([gapEntry, cleanEntry], outDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.format).toBe("toy-gap");
    expect(failures[0]?.reason).toContain("n");
    expect(errors).toEqual([`✗ toy-gap: ${failures[0]?.reason}`]);
    expect(readdirSync(outDir)).toEqual(["toy-clean.schema.json"]);
    expect(existsSync(join(outDir, "toy-gap.schema.json"))).toBe(false);
  });

  it("clears what an earlier build left in the directory", () => {
    const outDir = mkdtempSync(join(tmpdir(), "phax-schemas-json-"));
    writeFileSync(join(outDir, "stale.schema.json"), "{}\n");
    expect(writeJsonSchemas([cleanEntry], outDir)).toEqual([]);
    expect(readdirSync(outDir)).toEqual(["toy-clean.schema.json"]);
  });
});

describe("every exported format has a usable JSON Schema", () => {
  it.each(JSON_SCHEMA_FORMATS)("$format: compiles in a standard draft-07 validator", (entry) => {
    expect(() => new Ajv().compile(renderedSchema(entry))).not.toThrow();
  });

  it.each(FORMAT_IDS)("%s: validates the valid test document", (id) => {
    const entry = JSON_SCHEMA_FORMATS.find(({ format }) => format === id);
    if (entry === undefined) throw new Error(`no entry for ${id}`);
    const validate = new Ajv().compile(renderedSchema(entry));
    expect(validate(validDocuments[id]), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(JSON_SCHEMA_FORMATS)(
    "$format: validates every document phax's current decoder accepts",
    (entry) => {
      const validate = new Ajv().compile(renderedSchema(entry));
      const accepted = acceptedDocuments(entry);
      expect(accepted).toHaveLength(documentsOf(entry.format as JsonSchemaFormatId).length);
      for (const document of accepted) {
        const valid = validate(document);
        expect(valid, JSON.stringify(validate.errors)).toBe(true);
      }
    },
  );

  it.each(JSON_SCHEMA_FORMATS)(
    "$format: admits an unknown key exactly when the entry says ignore, as phax's decoder does",
    (entry) => {
      const validate = new Ajv().compile(renderedSchema(entry));
      const [document] = acceptedDocuments(entry);
      const withUnknownKey = { ...(document as object), unknownKey: true };
      const ignores = entry.excess === "ignore";
      expect(validate(withUnknownKey)).toBe(ignores);
      expect(Either.isRight(DECODERS[entry.format as JsonSchemaFormatId](withUnknownKey))).toBe(
        ignores,
      );
    },
  );
});
