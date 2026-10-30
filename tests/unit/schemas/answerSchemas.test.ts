// answerJsonSchema is the one rendering of an answer's schema: the prompts state
// it and the provider flags hand it over. It is exactly the published schema the
// build writes for the format, so a model is never given a copy that could drift.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORMAT_DEFINITIONS,
  JSON_SCHEMA_FORMATS,
  renderJsonSchemas,
} from "../../../packages/schemas/build/jsonSchemas.js";
import {
  ANSWER_FORMATS,
  answerJsonSchema,
  type AnswerFormatId,
} from "../../../src/schemas/answerSchemas.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";

const ANSWER_IDS = Object.keys(ANSWER_FORMATS) as ReadonlyArray<AnswerFormatId>;
const rendered = renderJsonSchemas(JSON_SCHEMA_FORMATS);
const snapshotsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "schemas",
  "snapshots",
);

describe("answerJsonSchema", () => {
  it("registers the nine answer formats", () => {
    expect(ANSWER_IDS).toEqual([
      "spec-document",
      "plan-document",
      "spec-hand-decision-answer",
      "plan-hand-decision-answer",
      "first-reading",
      "interactive-handoff",
      "code-review",
      "compliance-review",
      "phax-plan-extraction",
    ]);
  });

  it.each(ANSWER_IDS)("%s: is exactly the published schema the build writes", (id) => {
    const published = rendered.files.get(`${id}.schema.json`);
    expect(published, `${id}.schema.json`).toBeDefined();
    expect(answerJsonSchema(id)).toEqual(JSON.parse(published ?? "null"));
  });

  it.each(ANSWER_IDS)("%s: is the schema its next snapshot records", (id) => {
    const snapshot = readFileSync(join(snapshotsDir, id, "next.schema.json"), "utf8");
    expect(`${JSON.stringify(answerJsonSchema(id), null, 2)}\n`).toBe(snapshot);
  });

  it.each(ANSWER_IDS)("%s: carries the label of its format definition", (id) => {
    expect(ANSWER_FORMATS[id].label).toBe(FORMAT_DEFINITIONS[id].label);
    expect(answerJsonSchema(id)["title"]).toBe(`phax ${FORMAT_DEFINITIONS[id].label}`);
  });

  it.each(ANSWER_IDS)("%s: requires a $schema const of the format's current stamp", (id) => {
    const schema = answerJsonSchema(id) as {
      required: string[];
      properties: Record<string, { const?: string }>;
    };
    expect(schema.required[0]).toBe("$schema");
    expect(schema.properties["$schema"]?.const).toBe(schemaUrl(id, CURRENT_STAMPS[id]));
  });

  it.each(ANSWER_IDS)("%s: refuses a key it does not name, at the root", (id) => {
    expect(answerJsonSchema(id)).toMatchObject({ type: "object", additionalProperties: false });
  });
});
