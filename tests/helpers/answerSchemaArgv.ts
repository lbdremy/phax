import { expect } from "vitest";
import { claudeAnswerSchema } from "../../src/domain/session/structuredCalls.js";
import { answerJsonSchema, type AnswerFormatId } from "../../src/schemas/answerSchemas.js";

/**
 * The two argv words with which Claude Code is handed a format's answer
 * schema: minified, without its root `$schema` property.
 */
export const claudeSchemaArgs = (format: AnswerFormatId): [string, string] => [
  "--json-schema",
  JSON.stringify(claudeAnswerSchema(answerJsonSchema(format))),
];

/** What the fake codex logs as `outputSchema`: the file's content, the format's whole schema. */
export const codexSchemaFile = (format: AnswerFormatId): string =>
  `${JSON.stringify(answerJsonSchema(format))}\n`;

/**
 * The two argv words with which Codex is handed an answer schema: a file the
 * adapter writes in a temporary directory of its own.
 */
export const codexSchemaArgs = (): [string, unknown] => [
  "--output-schema",
  expect.stringMatching(/phax-answer-schema-[^/\\]+[/\\]answer\.schema\.json$/) as unknown,
];
