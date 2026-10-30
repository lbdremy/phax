// Every answer schema phax hands a provider fits Codex strict and Claude Code's
// key and size rules (ac-strict-shape), and none reaches Effect's own
// `Schema.NonEmptyString`. Both that one and src/schemas/strictString.ts carry
// the identifier NonEmptyString, and the first met in a walk silently takes
// `$defs.NonEmptyString`, so a forgotten one could hide behind the strict one
// in the rendered schema; the AST walk finds it wherever it sits.
import { Option, Schema, SchemaAST } from "effect";
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
        Schema.Struct({ loose: Schema.NonEmptyString.annotations({ description: "x" }) }),
      ),
      either: Schema.NullOr(Schema.NonEmptyString),
    });
    expect(effectNonEmptyStrings(Toy.ast)).toEqual(["list[].loose", "either|"]);
    expect(effectNonEmptyStrings(Schema.Struct({ strict: NonEmptyString }).ast)).toEqual([]);
  });
});

const EFFECT_FILTER = (Schema.NonEmptyString.ast as SchemaAST.Refinement).filter;
const STRICT_FILTER = (NonEmptyString.ast as SchemaAST.Refinement).filter;

/**
 * The paths of every node of Effect's `Schema.NonEmptyString` under `ast`: a
 * refinement sharing its filter, or one carrying the NonEmptyString identifier
 * that is not the strict string's.
 */
function effectNonEmptyStrings(ast: SchemaAST.AST): ReadonlyArray<string> {
  const found: string[] = [];
  const seen = new Set<SchemaAST.AST>();
  const walk = (node: SchemaAST.AST, path: string): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (SchemaAST.isRefinement(node)) {
      const named =
        Option.getOrUndefined(SchemaAST.getIdentifierAnnotation(node)) === "NonEmptyString";
      if (node.filter === EFFECT_FILTER || (named && node.filter !== STRICT_FILTER)) {
        found.push(path);
      } else {
        walk(node.from, path);
      }
    } else if (SchemaAST.isTypeLiteral(node)) {
      for (const property of node.propertySignatures) {
        const name = String(property.name);
        walk(property.type, path === "" ? name : `${path}.${name}`);
      }
      for (const signature of node.indexSignatures) walk(signature.type, `${path}.*`);
    } else if (SchemaAST.isTupleType(node)) {
      for (const element of node.elements) walk(element.type, `${path}[]`);
      for (const rest of node.rest) walk(rest.type, `${path}[]`);
    } else if (SchemaAST.isUnion(node)) {
      for (const member of node.types) walk(member, `${path}|`);
    } else if (SchemaAST.isSuspend(node)) {
      walk(node.f(), path);
    } else if (SchemaAST.isTransformation(node)) {
      walk(node.from, path);
      walk(node.to, path);
    } else if (SchemaAST.isDeclaration(node)) {
      for (const parameter of node.typeParameters) walk(parameter, path);
    }
  };
  walk(ast, "");
  return found;
}
