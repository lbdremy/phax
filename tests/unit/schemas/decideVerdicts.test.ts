import { Ajv } from "ajv";
import { Either, ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeDecideVerdictsFile,
  getDecideVerdictsFileJsonSchema,
} from "../../../src/schemas/decideVerdicts.js";
import { currentSchemaUrl, decodeCurrentDecideVerdicts } from "../../../src/schemas/persisted.js";

// The decide-verdicts file (spec artifact-decide-verdicts): born with
// `$schema`, every key required, unknown keys refused at any level, a
// non-empty list of verdicts, and a note that is a non-empty string or null.
// Every document is made up.

type Doc = Record<string, unknown>;

function verdictsFile(extra: Doc = {}): Doc {
  return {
    $schema: currentSchemaUrl("decide-verdicts"),
    artifact: "docs/specs/2610250900-log-rotation.md",
    verdicts: [
      { question: "Q1", chosen: "per-run", note: null },
      { question: "Q2", chosen: "other", note: "Keep the last ten runs, whatever their age." },
    ],
    ...extra,
  };
}

function firstIssue(input: unknown): { path: string; message: string } {
  const decoded = decodeDecideVerdictsFile(input);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  const [issue] = ParseResult.ArrayFormatter.formatErrorSync(decoded.left);
  return { path: (issue?.path ?? []).join("."), message: issue?.message ?? "" };
}

const validate = new Ajv().compile(getDecideVerdictsFileJsonSchema());
const jsonSchemaAccepts = (input: unknown): boolean => validate(input) === true;
const decoderAccepts = (input: unknown): boolean => Either.isRight(decodeDecideVerdictsFile(input));

describe("decide-verdicts", () => {
  it("decodes a file whose verdicts follow a recommendation, depart or choose other", () => {
    expect(decoderAccepts(verdictsFile())).toBe(true);
  });

  it("is read by the current-shape bridge without its $schema", () => {
    const { $schema: _schema, ...expected } = verdictsFile();
    expect(Either.getOrThrow(decodeCurrentDecideVerdicts(verdictsFile()))).toEqual(expected);
  });

  it("titles its JSON Schema", () => {
    expect(getDecideVerdictsFileJsonSchema()).toMatchObject({ title: "phax decide verdicts" });
  });

  const refused: ReadonlyArray<readonly [string, Doc, string]> = [
    ["a missing artifact", { artifact: undefined }, "artifact"],
    ["a missing verdicts list", { verdicts: undefined }, "verdicts"],
    ["an empty verdicts list", { verdicts: [] }, "verdicts.0"],
    ["an empty artifact", { artifact: "" }, "artifact"],
    ["an unknown top-level key", { reviewer: "human" }, "reviewer"],
    [
      "an unknown key on a verdict",
      { verdicts: [{ question: "Q1", chosen: "a", note: null, why: "x" }] },
      "verdicts.0.why",
    ],
    [
      "a verdict without a note key",
      { verdicts: [{ question: "Q1", chosen: "a" }] },
      "verdicts.0.note",
    ],
    [
      "a verdict without a question",
      { verdicts: [{ chosen: "a", note: null }] },
      "verdicts.0.question",
    ],
    [
      "a verdict without a chosen id",
      { verdicts: [{ question: "Q1", note: null }] },
      "verdicts.0.chosen",
    ],
    ["an empty note", { verdicts: [{ question: "Q1", chosen: "a", note: "" }] }, "verdicts.0.note"],
    [
      "a note that is not a string",
      { verdicts: [{ question: "Q1", chosen: "a", note: 3 }] },
      "verdicts.0.note",
    ],
    [
      "a question id holding whitespace",
      { verdicts: [{ question: "Q 1", chosen: "a", note: null }] },
      "verdicts.0.question",
    ],
    [
      "a chosen id holding whitespace",
      { verdicts: [{ question: "Q1", chosen: "a b", note: null }] },
      "verdicts.0.chosen",
    ],
    [
      "a $schema naming another format",
      { $schema: currentSchemaUrl("hand-decision-answer") },
      "$schema",
    ],
  ];

  it.each(refused)("refuses %s, at the path of its first violation", (_name, change, path) => {
    const input = { ...verdictsFile(), ...change };
    for (const key of Object.keys(change)) {
      if (change[key] === undefined) delete input[key];
    }
    expect(decoderAccepts(input)).toBe(false);
    expect(firstIssue(input).path).toBe(path);
  });

  it("refuses a file without $schema", () => {
    const { $schema: _schema, ...bare } = verdictsFile();
    expect(firstIssue(bare).path).toBe("$schema");
  });

  it("refuses a value that is not an object", () => {
    for (const input of [null, [], "verdicts", 3]) expect(decoderAccepts(input)).toBe(false);
  });
});

describe("the decide-verdicts JSON Schema", () => {
  const documents: ReadonlyArray<readonly [string, unknown]> = [
    ["a valid file", verdictsFile()],
    ["a note of null", verdictsFile({ verdicts: [{ question: "Q1", chosen: "a", note: null }] })],
    ["an empty verdicts list", verdictsFile({ verdicts: [] })],
    ["an unknown top-level key", verdictsFile({ extra: true })],
    [
      "an unknown key on a verdict",
      verdictsFile({ verdicts: [{ question: "Q1", chosen: "a", note: null, extra: 1 }] }),
    ],
    ["an empty note", verdictsFile({ verdicts: [{ question: "Q1", chosen: "a", note: "" }] })],
    ["a missing note", verdictsFile({ verdicts: [{ question: "Q1", chosen: "a" }] })],
    [
      "a chosen id with whitespace",
      verdictsFile({ verdicts: [{ question: "Q1", chosen: "a b", note: null }] }),
    ],
    ["an empty artifact", verdictsFile({ artifact: "" })],
    ["another format's $schema", verdictsFile({ $schema: currentSchemaUrl("registry") })],
    ["a non-object", []],
  ];

  it.each(documents)("agrees with the decoder on %s", (_name, document) => {
    expect(jsonSchemaAccepts(document), JSON.stringify(validate.errors)).toBe(
      decoderAccepts(document),
    );
  });

  it("describes chosen as an option id or the reserved other, and the departure rule on note", () => {
    const text = JSON.stringify(getDecideVerdictsFileJsonSchema());
    expect(text).toContain("reserved `other`");
    expect(text).toContain("departs from the question's recommendation");
  });
});
