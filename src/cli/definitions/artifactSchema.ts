// `phax artifact schema <kind>` as the runner reads it: the JSON Schema of the spec document, the
// plan document or a decide verdicts file, as a document — its bytes are today's, the schema
// pretty-printed with two spaces and one newline, in both modes. It writes no file, so it takes
// no `--out`.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { answerJsonSchema } from "../../schemas/answerSchemas.js";
import { getDecideVerdictsFileJsonSchema } from "../../schemas/decideVerdicts.js";
import { defineCommand, document, reject } from "../commandLibrary/contract/index.js";

const DOCUMENT_JSON_SCHEMAS = {
  spec: () => answerJsonSchema("spec-document"),
  plan: () => answerJsonSchema("plan-document"),
  verdicts: getDecideVerdictsFileJsonSchema,
} as const;

const SchemaOutput = Schema.Struct({
  kind: Schema.Literals(["spec", "plan", "verdicts"]),
  schema: Schema.Record(Schema.String, Schema.Unknown),
});

export const artifactSchemaCommand = defineCommand({
  name: "schema",
  summary:
    "Print the JSON Schema of the spec or plan document, or of a decide verdicts file (experimental)",
  help: "Prints the JSON Schema of the experimental spec document (kind spec) or plan document (kind plan), or of a decide verdicts file (kind verdicts, the input of `phax artifact decide --verdicts`), pretty-printed to stdout, so a consumer can read the contract a headless authoring session must satisfy, or the file to write, without a model call.\n\nThe spec and plan document formats are experimental: outside the version 1 stability promise, they may change between releases. The printed spec or plan schema is the published answer schema a headless authoring session answers, its `$schema` a const naming the current stamp; the plan document's extracted fields are the extracted-plan shape phax run reads. phax checks, when it decodes a document, what the schema does not express: traceability (every acceptance criterion references existing requirements, every requirement is covered), the question checks (unique question ids, a recommendation among a question's options), the plan's sourceSpec/completesSpec pairing, and an authoring answer's empty arbitratedQuestions.\n\nSide effects: none — read-only.",
  examples: [
    "phax artifact schema spec",
    "phax artifact schema plan",
    "phax artifact schema verdicts",
  ],
  input: {
    args: reject(
      Schema.Tuple([
        Schema.Literals(["spec", "plan", "verdicts"]).annotate({
          identifier: "kind",
          description: "Document kind: spec, plan or verdicts",
        }),
      ]),
    ),
  },
  output: reject(SchemaOutput),
  run: ({ input }) =>
    Effect.sync(() => {
      const kind = input.args[0];
      return { kind, schema: { ...DOCUMENT_JSON_SCHEMAS[kind]() } };
    }),
  exits: {},
  document: (value) => document(`${JSON.stringify(value.schema, null, 2)}\n`, { format: null }),
  render: (value) => JSON.stringify(value.schema, null, 2),
});
