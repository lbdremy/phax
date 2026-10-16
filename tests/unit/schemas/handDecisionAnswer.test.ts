// The hand decision answer at decode level: a spec's and a plan's answer
// decode, and every key is required, unknown keys, a lifted verdict and a plan
// verdict without its phase are refused. Every document is made up.
import { Either, ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeHandDecisionAnswerFile,
  getHandDecisionAnswerFileJsonSchema,
} from "../../../src/schemas/handDecisionAnswer.js";
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
    $schema: currentSchemaUrl("hand-decision-answer"),
    kind: "spec",
    decisions: [{ id: "Q2", verdict: decided() }],
    markdown: "---\nstatus: Draft\n---\n# Log rotation\n",
  };
}

function planAnswer(): Doc {
  return {
    ...specAnswer(),
    kind: "plan",
    decisions: [{ id: "q-scope", verdict: decided({ phase: "phase-02" }) }],
  };
}

function firstIssue(input: unknown): { path: string; message: string } {
  const decoded = decodeHandDecisionAnswerFile(input);
  if (Either.isRight(decoded)) throw new Error("expected a refusal");
  const [issue] = ParseResult.ArrayFormatter.formatErrorSync(decoded.left);
  return { path: (issue?.path ?? []).join("."), message: issue?.message ?? "" };
}

describe("hand-decision-answer", () => {
  it("decodes a spec's answer and a plan's answer", () => {
    expect(Either.isRight(decodeHandDecisionAnswerFile(specAnswer()))).toBe(true);
    expect(Either.isRight(decodeHandDecisionAnswerFile(planAnswer()))).toBe(true);
  });

  it("decodes an answer that decided nothing", () => {
    expect(Either.isRight(decodeHandDecisionAnswerFile({ ...specAnswer(), decisions: [] }))).toBe(
      true,
    );
  });

  it("the bridge drops $schema and keeps every other key", () => {
    const decoded = decodeCurrentHandDecisionAnswer(specAnswer());
    if (Either.isLeft(decoded)) throw new Error(decoded.left.message);
    const { $schema: _schema, ...rest } = specAnswer();
    expect(decoded.right).toEqual(rest);
  });

  it("refuses an unknown key at the root and inside a verdict", () => {
    expect(firstIssue({ ...specAnswer(), note: "extra" }).path).toBe("note");
    const answer = { ...specAnswer(), decisions: [{ id: "Q2", verdict: decided({ note: "x" }) }] };
    expect(firstIssue(answer).path).toBe("decisions.0.verdict.note");
  });

  it.each(["$schema", "kind", "decisions", "markdown"])("refuses an answer without %s", (key) => {
    const { [key]: _dropped, ...rest } = specAnswer();
    expect(Either.isLeft(decodeHandDecisionAnswerFile(rest))).toBe(true);
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
    const answer = { ...specAnswer(), decisions: [{ id: "Q2", verdict: lifted }] };
    expect(firstIssue(answer).path).toMatch(/^decisions\.0\.verdict/);
  });

  it("refuses a plan verdict without its phase", () => {
    const answer = { ...planAnswer(), decisions: [{ id: "q-scope", verdict: decided() }] };
    expect(firstIssue(answer).path).toBe("decisions.0.verdict.phase");
  });

  it("refuses a spec verdict that names a phase", () => {
    const answer = {
      ...specAnswer(),
      decisions: [{ id: "Q2", verdict: decided({ phase: "phase-01" }) }],
    };
    expect(firstIssue(answer).path).toBe("decisions.0.verdict.phase");
  });

  it("refuses another format's $schema and an empty markdown", () => {
    expect(firstIssue({ ...specAnswer(), $schema: currentSchemaUrl("spec-document") }).path).toBe(
      "$schema",
    );
    expect(firstIssue({ ...specAnswer(), markdown: "" }).path).toBe("markdown");
  });

  it("renders a JSON Schema with a branch per kind", () => {
    const schema = getHandDecisionAnswerFileJsonSchema() as { anyOf?: unknown[] };
    expect(schema.anyOf).toHaveLength(2);
  });
});
