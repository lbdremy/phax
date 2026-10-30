// The hand decision answers at decode level: spec-hand-decision-answer and
// plan-hand-decision-answer each decode their own kind, every key is required,
// and unknown keys, a lifted verdict, a spec verdict naming a phase and a plan
// verdict without one are refused. Every document is made up.
import { Either, ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { answerJsonSchema } from "../../../src/schemas/answerSchemas.js";
import {
  decodePlanHandDecisionAnswerFile,
  decodeSpecHandDecisionAnswerFile,
} from "../../../src/schemas/handDecisionAnswer.js";
import { decodeHandDecisionAnswerV0_25_0 } from "../../../src/schemas/history/hand-decision-answer/0.25.0.js";
import {
  currentSchemaUrl,
  decodeCurrentHandDecisionAnswer,
} from "../../../src/schemas/persisted.js";

type Doc = Record<string, unknown>;

function decided(extra: Doc = {}): Doc {
  return {
    kind: "decided",
    chosen: "rotate-daily",
    abandoned: ["per-run"],
    why: "a bounded log directory matters more",
    advocate: "a log per run names its run",
    principles: ["S1"],
    reversibility: "cheap",
    by: { kind: "operator", name: "Grace Hopper" },
    at: "2026-10-16T09:30:00Z",
    revised: ["## 5. Requirements"],
    ...extra,
  };
}

function specAnswer(): Doc {
  return {
    $schema: currentSchemaUrl("spec-hand-decision-answer"),
    kind: "spec",
    decisions: [{ id: "Q2", verdict: decided() }],
    markdown: "---\nstatus: Draft\n---\n# Log rotation\n",
  };
}

function planAnswer(): Doc {
  return {
    ...specAnswer(),
    $schema: currentSchemaUrl("plan-hand-decision-answer"),
    kind: "plan",
    decisions: [{ id: "q-scope", verdict: decided({ phase: "phase-02" }) }],
  };
}

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

function firstIssue(decode: Decode, input: unknown): { path: string; message: string } {
  const decoded = decode(input);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  const [issue] = ParseResult.ArrayFormatter.formatErrorSync(decoded.left);
  return { path: (issue?.path ?? []).join("."), message: issue?.message ?? "" };
}

const KINDS = [
  { kind: "spec" as const, decode: decodeSpecHandDecisionAnswerFile as Decode, answer: specAnswer },
  { kind: "plan" as const, decode: decodePlanHandDecisionAnswerFile as Decode, answer: planAnswer },
];

describe.each(KINDS)("$kind-hand-decision-answer", ({ kind, decode, answer }) => {
  it("decodes its kind's answer, and one that decided nothing", () => {
    expect(Either.isRight(decode(answer()))).toBe(true);
    expect(Either.isRight(decode({ ...answer(), decisions: [] }))).toBe(true);
  });

  it("refuses the other kind's answer, at $schema", () => {
    const other = kind === "spec" ? planAnswer() : specAnswer();
    expect(firstIssue(decode, other).path).toBe("$schema");
  });

  it("the bridge decodes with the kind's format, drops $schema and keeps every other key", () => {
    const decoded = decodeCurrentHandDecisionAnswer(answer(), kind);
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
    const { $schema: _schema, ...rest } = answer();
    expect(decoded.right).toEqual(rest);
  });

  it("refuses an unknown key at the root and inside a verdict", () => {
    expect(firstIssue(decode, { ...answer(), note: "extra" }).path).toBe("note");
    const [first] = answer()["decisions"] as Array<{ id: string; verdict: Doc }>;
    const noted = { ...first, verdict: { ...first!.verdict, note: "x" } };
    expect(firstIssue(decode, { ...answer(), decisions: [noted] }).path).toBe(
      "decisions.0.verdict.note",
    );
  });

  it.each(["$schema", "kind", "decisions", "markdown"])("refuses an answer without %s", (key) => {
    const { [key]: _dropped, ...rest } = answer();
    expect(Either.isLeft(decode(rest))).toBe(true);
  });

  it("refuses a lifted verdict", () => {
    const lifted = {
      kind: "lifted",
      chosen: "rotate-daily",
      abandoned: ["per-run"],
      why: "Decided by the author on 2026-09-28",
      at: "2026-09-28",
      by: { kind: "unattributed" },
    };
    const refused = { ...answer(), decisions: [{ id: "Q2", verdict: lifted }] };
    expect(firstIssue(decode, refused).path).toMatch(/^decisions\.0\.verdict/);
  });

  it("refuses another format's $schema and an empty markdown", () => {
    expect(
      firstIssue(decode, { ...answer(), $schema: currentSchemaUrl("spec-document") }).path,
    ).toBe("$schema");
    expect(firstIssue(decode, { ...answer(), markdown: "" }).path).toBe("markdown");
  });

  it("renders one closed object, its $schema a const, with no anyOf at the root", () => {
    const schema = answerJsonSchema(`${kind}-hand-decision-answer`) as {
      anyOf?: unknown;
      additionalProperties: boolean;
      required: string[];
      properties: { $schema: { const: string } };
    };
    expect(schema.anyOf).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["$schema", "kind", "decisions", "markdown"]);
    expect(schema.properties.$schema.const).toBe(currentSchemaUrl(`${kind}-hand-decision-answer`));
  });
});

describe("the per-kind verdict shape", () => {
  it("refuses a plan verdict without its phase, naming phase", () => {
    const answer = { ...planAnswer(), decisions: [{ id: "q-scope", verdict: decided() }] };
    expect(firstIssue(decodePlanHandDecisionAnswerFile, answer).path).toBe(
      "decisions.0.verdict.phase",
    );
  });

  it("refuses a spec verdict that names a phase, naming phase", () => {
    const answer = {
      ...specAnswer(),
      decisions: [{ id: "Q2", verdict: decided({ phase: "phase-01" }) }],
    };
    expect(firstIssue(decodeSpecHandDecisionAnswerFile, answer).path).toBe(
      "decisions.0.verdict.phase",
    );
  });
});

describe("hand-decision-answer, frozen at 0.25.0", () => {
  const retired = currentSchemaUrl("hand-decision-answer");

  it("still reads either member of its root union", () => {
    for (const answer of [specAnswer(), planAnswer()]) {
      expect(Either.isRight(decodeHandDecisionAnswerV0_25_0({ ...answer, $schema: retired }))).toBe(
        true,
      );
    }
  });

  it("is not a current answer: neither kind's format reads its stamp", () => {
    expect(
      firstIssue(decodeSpecHandDecisionAnswerFile, { ...specAnswer(), $schema: retired }).path,
    ).toBe("$schema");
    expect(
      firstIssue(decodePlanHandDecisionAnswerFile, { ...planAnswer(), $schema: retired }).path,
    ).toBe("$schema");
  });
});
