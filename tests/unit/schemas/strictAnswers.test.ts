// Every answer schema phax hands a provider fits Codex strict and Claude Code's
// key and size rules (ac-strict-shape), and none reaches Effect's own
// `Schema.NonEmptyString`. Both that one and src/schemas/strictString.ts carry
// the identifier NonEmptyString, and the first met in a walk silently takes
// `$defs.NonEmptyString`, so a forgotten one could hide behind the strict one
// in the rendered schema; the AST walk finds it wherever it sits.
import { Schema, SchemaAST } from "effect";
import { describe, expect, it } from "vitest";
import { strictCheckFindings } from "../../../packages/schemas/build/strictCheck.js";
import {
  ANSWER_FORMATS,
  answerJsonSchema,
  type AnswerFormatId,
} from "../../../src/schemas/answerSchemas.js";
import { NonEmptyString } from "../../../src/schemas/strictString.js";

const ANSWER_IDS = Object.keys(ANSWER_FORMATS) as ReadonlyArray<AnswerFormatId>;

describe("the answer registry", () => {
  it("holds exactly the nine answer formats", () => {
    expect([...ANSWER_IDS].toSorted()).toEqual(
      [
        "spec-document",
        "plan-document",
        "spec-hand-decision-answer",
        "plan-hand-decision-answer",
        "first-reading",
        "interactive-handoff",
        "code-review",
        "compliance-review",
        "phax-plan-extraction",
      ].toSorted(),
    );
  });
});

describe.each(ANSWER_IDS)("%s", (format) => {
  it("passes the strict check", () => {
    expect(strictCheckFindings(format, answerJsonSchema(format))).toEqual([]);
  });

  it("reaches no node of Effect's Schema.NonEmptyString", () => {
    expect(effectNonEmptyStrings(ANSWER_FORMATS[format].schema.ast)).toEqual([]);
  });
});

describe("effectNonEmptyStrings", () => {
  it("finds Effect's NonEmptyString, annotated or not, deep in a struct, and never the strict one", () => {
    const Toy = Schema.Struct({
      strict: NonEmptyString,
      list: Schema.Array(
        Schema.Struct({ loose: Schema.NonEmptyString.annotate({ description: "x" }) }),
      ),
      either: Schema.NullOr(Schema.NonEmptyString),
    });
    expect(effectNonEmptyStrings(Toy.ast)).toEqual(["list[].loose", "either|"]);
    expect(effectNonEmptyStrings(Schema.Struct({ strict: NonEmptyString }).ast)).toEqual([]);
  });
});

// A node's check as Effect builds it: a filter, its `run` kept by every `annotate`.
function onlyFilter(ast: SchemaAST.AST): SchemaAST.Filter<never> {
  const [check] = ast.checks ?? [];
  if (!(check instanceof SchemaAST.Filter)) throw new Error("expected a node with one filter");
  return check;
}

const EFFECT_RUN = onlyFilter(Schema.NonEmptyString.ast).run;
const STRICT_RUN = onlyFilter(NonEmptyString.ast).run;

// Effect's NonEmptyString check: one sharing its filter, or one carrying the
// NonEmptyString identifier that is not the strict string's.
function isEffectNonEmpty(check: SchemaAST.Check<never>): boolean {
  if (check instanceof SchemaAST.FilterGroup) return check.checks.some(isEffectNonEmpty);
  const named = check.annotations?.identifier === "NonEmptyString";
  return check.run === EFFECT_RUN || (named && check.run !== STRICT_RUN);
}

/**
 * The paths of every node of Effect's `Schema.NonEmptyString` under `ast`: a
 * node holding its check, or a check carrying the NonEmptyString identifier
 * that is not the strict string's.
 */
function effectNonEmptyStrings(ast: SchemaAST.AST): ReadonlyArray<string> {
  const found: string[] = [];
  const seen = new Set<SchemaAST.AST>();
  const walk = (node: SchemaAST.AST, path: string): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.checks?.some(isEffectNonEmpty)) {
      found.push(path);
      return;
    }
    for (const link of node.encoding ?? []) walk(link.to, path);
    if (SchemaAST.isObjects(node)) {
      for (const property of node.propertySignatures) {
        const name = String(property.name);
        walk(property.type, path === "" ? name : `${path}.${name}`);
      }
      for (const signature of node.indexSignatures) walk(signature.type, `${path}.*`);
    } else if (SchemaAST.isArrays(node)) {
      for (const element of node.elements) walk(element, `${path}[]`);
      for (const rest of node.rest) walk(rest, `${path}[]`);
    } else if (SchemaAST.isUnion(node)) {
      for (const member of node.types) walk(member, `${path}|`);
    } else if (SchemaAST.isSuspend(node)) {
      walk(node.thunk(), path);
    } else if (SchemaAST.isDeclaration(node)) {
      for (const parameter of node.typeParameters) walk(parameter, path);
    }
  };
  walk(ast, "");
  return found;
}
