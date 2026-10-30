import { describe, expect, it } from "vitest";
import {
  claudeAnswerSchema,
  handsSchemaNatively,
  STRUCTURED_CALLS,
  stampStructuredValue,
  type StructuredCallId,
  type StructuredCallsTable,
} from "../../../src/domain/session/structuredCalls.js";
import { answerJsonSchema } from "../../../src/schemas/answerSchemas.js";

const CALLS: readonly StructuredCallId[] = [
  "authoring",
  "plan-extraction",
  "decide-handback",
  "decide-verdicts",
  "first-turn",
  "closing-turn",
  "code-review",
  "compliance-review",
];

const allPrompt: StructuredCallsTable = Object.fromEntries(
  CALLS.map((call) => [call, { claudeCode: "prompt" }]),
) as unknown as StructuredCallsTable;

describe("STRUCTURED_CALLS", () => {
  it("has a line for exactly the eight structured calls", () => {
    expect(Object.keys(STRUCTURED_CALLS).toSorted()).toEqual([...CALLS].toSorted());
  });

  it.each(CALLS)("starts %s native on Claude Code", (call) => {
    expect(STRUCTURED_CALLS[call]).toEqual({ claudeCode: "native" });
  });
});

describe("handsSchemaNatively", () => {
  it.each(CALLS)("follows the table on Claude Code for %s", (call) => {
    expect(handsSchemaNatively("claude-code", call, STRUCTURED_CALLS)).toBe(true);
    expect(handsSchemaNatively("claude-code", call, allPrompt)).toBe(false);
  });

  it("flips one call alone", () => {
    const flipped: StructuredCallsTable = {
      ...STRUCTURED_CALLS,
      "decide-verdicts": { claudeCode: "prompt" },
    };
    const natives = CALLS.filter((call) => handsSchemaNatively("claude-code", call, flipped));
    expect(natives).toEqual(CALLS.filter((call) => call !== "decide-verdicts"));
  });

  it.each(CALLS)("is always true for Codex, whatever the table says (%s)", (call) => {
    expect(handsSchemaNatively("codex-cli", call, STRUCTURED_CALLS)).toBe(true);
    expect(handsSchemaNatively("codex-cli", call, allPrompt)).toBe(true);
  });

  it.each(CALLS)("is always false for Mistral Vibe (%s)", (call) => {
    expect(handsSchemaNatively("mistral-vibe", call, STRUCTURED_CALLS)).toBe(false);
  });
});

describe("claudeAnswerSchema", () => {
  const schema = answerJsonSchema("spec-document") as Record<string, unknown>;

  it("removes exactly the root $schema property, from properties and from required", () => {
    const handed = claudeAnswerSchema(schema);
    const before = schema["properties"] as Record<string, unknown>;
    const after = handed["properties"] as Record<string, unknown>;
    expect(Object.keys(before)).toContain("$schema");
    expect(Object.keys(after)).toEqual(Object.keys(before).filter((key) => key !== "$schema"));
    expect(schema["required"]).toContain("$schema");
    expect(handed["required"]).toEqual(
      (schema["required"] as string[]).filter((key) => key !== "$schema"),
    );
  });

  it("keeps every other root keyword, the dialect $schema keyword included", () => {
    const handed = claudeAnswerSchema(schema);
    const { properties: _p, required: _r, ...restBefore } = schema;
    const { properties: _hp, required: _hr, ...restAfter } = handed;
    expect(restAfter).toEqual(restBefore);
  });

  it("leaves its input untouched", () => {
    const copy = structuredClone(schema);
    claudeAnswerSchema(schema);
    expect(schema).toEqual(copy);
  });

  it.each([
    "spec-document",
    "plan-document",
    "spec-hand-decision-answer",
    "plan-hand-decision-answer",
    "first-reading",
    "interactive-handoff",
    "code-review",
    "phax-plan-extraction",
  ] as const)("leaves no $schema property in the %s schema", (format) => {
    const handed = claudeAnswerSchema(answerJsonSchema(format));
    expect(Object.keys(handed["properties"] as object)).not.toContain("$schema");
    expect(handed["required"]).not.toContain("$schema");
  });
});

describe("stampStructuredValue", () => {
  const schema = answerJsonSchema("code-review");
  const stamp = (schema as { properties: { $schema: { const: string } } }).properties.$schema.const;

  it("sets the handed format's stamp first", () => {
    const stamped = stampStructuredValue({ summary: "ok", findings: [] }, schema);
    expect(Object.keys(stamped as object)[0]).toBe("$schema");
    expect(stamped).toEqual({ $schema: stamp, summary: "ok", findings: [] });
  });

  it("replaces a stamp the value already carries", () => {
    const stamped = stampStructuredValue({ $schema: "elsewhere", x: 1 }, schema);
    expect(stamped).toEqual({ $schema: stamp, x: 1 });
    expect(Object.keys(stamped as object)).toEqual(["$schema", "x"]);
  });

  it.each([[null], [[1, 2]], ["text"], [3]])("returns %j as is", (value) => {
    expect(stampStructuredValue(value, schema)).toBe(value);
  });

  it("returns the value as is when the schema names no stamp", () => {
    const value = { a: 1 };
    expect(stampStructuredValue(value, { type: "object" })).toBe(value);
  });
});
