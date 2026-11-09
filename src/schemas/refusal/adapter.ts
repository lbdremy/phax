import { Effect, Option, ParseResult, Schema, SchemaAST } from "effect";
import type { Refusal, RefusalPath } from "./model.js";

/**
 * The refusals of an Effect 3 decode failure, in the order of
 * `ParseResult.ArrayFormatter.formatErrorSync`'s issues and at its paths. This
 * is the only module that reads Effect's issues.
 *
 * It walks the `ParseIssue` tree as ArrayFormatter's traversal does, and
 * resolves `message` annotations as Effect 3 does, but builds every label
 * itself: it never calls a formatter and never reads the text Effect writes
 * for an issue. Two departures from ArrayFormatter's list, both about unions:
 * a union whose every member refused at its own path is one refusal, and a
 * union where some member got deeper drops the members that did not.
 */
export function refusalsOf(error: ParseResult.ParseError): ReadonlyArray<Refusal> {
  return walk(error.issue, [], undefined);
}

/** The first of `refusalsOf(error)`, or `undefined` when there is none. */
export function firstRefusal(error: ParseResult.ParseError): Refusal | undefined {
  return refusalsOf(error)[0];
}

type ValueKind = "invalid-type" | "invalid-value" | "filter";

// The kind and label of the node a value refusal is about.
type Described = { readonly kind: ValueKind; readonly expected: string };

// The label parts of a collapsed union refusal, so that a union nested in a
// union reads as one flat list (`one of an object | null | string`).
const unionParts = new WeakMap<Refusal, ReadonlyArray<string>>();

// ---------------------------------------------------------------------------
// The tree walk. Mirrors `getArrayFormatterIssues` in effect/src/ParseResult.ts.
// `owner` is the struct or tuple whose Composite holds the current Pointer, so
// an Unexpected key can be labelled from that shape's own signatures.
// ---------------------------------------------------------------------------

function walk(
  issue: ParseResult.ParseIssue,
  path: RefusalPath,
  owner: SchemaAST.AST | undefined,
): ReadonlyArray<Refusal> {
  if (issue instanceof ParseResult.Type) {
    return [valueRefusal(issue, path, messageOf(issue) ?? filterText(issue))];
  }
  if (issue instanceof ParseResult.Forbidden) {
    return [
      {
        kind: "invalid-value",
        path,
        expected: "a value decoded synchronously",
        actual: issue.actual,
        message: null,
      },
    ];
  }
  if (issue instanceof ParseResult.Unexpected) return [unexpectedRefusal(issue, path, owner)];
  if (issue instanceof ParseResult.Missing) {
    const message = missingMessageOf(issue);
    return [message === undefined ? { kind: "missing", path } : { kind: "missing", path, message }];
  }
  if (issue instanceof ParseResult.Pointer) {
    return walk(issue.issue, [...path, ...pointerPath(issue.path)], owner);
  }
  const message = messageOf(issue);
  if (message !== undefined) return [valueRefusal(issue, path, message)];
  if (issue instanceof ParseResult.Composite) {
    const members: ReadonlyArray<ParseResult.ParseIssue> = isIssueList(issue.issues)
      ? issue.issues
      : [issue.issues];
    if (SchemaAST.isUnion(issue.ast)) return unionRefusals(members, path);
    return members.flatMap((member) => walk(member, path, issue.ast));
  }
  // A Refinement (From or Predicate) or a Transformation (any side): its inner issue.
  return walk(issue.issue, path, undefined);
}

function isIssueList(
  issues: ParseResult.Composite["issues"],
): issues is readonly [ParseResult.ParseIssue, ...ParseResult.ParseIssue[]] {
  return Array.isArray(issues);
}

function pointerPath(path: ParseResult.Pointer["path"]): ReadonlyArray<PropertyKey> {
  return Array.isArray(path) ? path : [path as PropertyKey];
}

// A refusal about the value at `path`, for an issue whose message is `message`
// (null when there is none). The kind and the label come from the issue's AST.
function valueRefusal(
  issue:
    | ParseResult.Type
    | ParseResult.Composite
    | ParseResult.Refinement
    | ParseResult.Transformation,
  path: RefusalPath,
  message: string | null | undefined,
): Refusal {
  const { kind, expected } = describe(issue);
  return { kind, path, expected, actual: issue.actual, message: message ?? null };
}

function unexpectedRefusal(
  issue: ParseResult.Unexpected,
  path: RefusalPath,
  owner: SchemaAST.AST | undefined,
): Refusal {
  if (owner !== undefined && (SchemaAST.isTypeLiteral(owner) || SchemaAST.isTupleType(owner))) {
    return { kind: "unexpected", path, expected: allowedKeysLabel(owner) };
  }
  // Only phax builds an Unexpected outside a struct or a tuple (the plan
  // front matter's `completes-spec` beside `source-spec: null`), so its text
  // is phax's own.
  const text = issue.message;
  return text === undefined
    ? { kind: "unexpected", path, expected: "never" }
    : { kind: "unexpected", path, expected: "never", message: text };
}

// The keys a struct or tuple allows, as Effect 3 lists them: a struct's index
// signature parameters then its property names, a tuple's element indices,
// joined by ` | `, `never` when there is none.
function allowedKeysLabel(owner: SchemaAST.TypeLiteral | SchemaAST.TupleType): string {
  const parts = SchemaAST.isTypeLiteral(owner)
    ? [
        ...owner.indexSignatures.map((signature) => labelOf(signature.parameter)),
        ...owner.propertySignatures.map(({ name }) =>
          typeof name === "string" ? JSON.stringify(name) : String(name),
        ),
      ]
    : owner.elements.map((_, index) => String(index));
  return parts.length > 0 ? parts.join(" | ") : "never";
}

// ---------------------------------------------------------------------------
// Unions.
// ---------------------------------------------------------------------------

function unionRefusals(
  members: ReadonlyArray<ParseResult.ParseIssue>,
  path: RefusalPath,
): ReadonlyArray<Refusal> {
  const refused = members.map((member) => walk(member, path, undefined));
  const isShallow = (refusals: ReadonlyArray<Refusal>): boolean =>
    refusals.length === 1 &&
    samePath(refusals[0]!.path, path) &&
    (refusals[0]!.kind === "invalid-type" || refusals[0]!.kind === "invalid-value");
  if (!refused.every(isShallow)) {
    // Members told apart by their keys (`outcome: "committed" | "failed"`, a key only one
    // variant declares). A member refused on a key of its own, a literal the value misses
    // or a key it does not declare, is not the one the input chose when another member
    // declares each such key and its type there accepts the input's value. Its line
    // (`outcome: Expected "failed"`) then gives way to the chosen member's
    // (`arbitrated: is missing`). When no member is left, every deeper member's refusals
    // stay, in Effect 3's order.
    const deeper = members.flatMap((member, i) =>
      isShallow(refused[i]!) ? [] : [{ member, refusals: refused[i]! }],
    );
    const properties = deeper.map(({ member }) => propertiesOf(member));
    const shapeMisses = deeper.map(({ refusals }) =>
      refusals.filter(
        (r) =>
          (r.kind === "invalid-value" || r.kind === "unexpected") &&
          r.path.length === path.length + 1 &&
          samePrefix(r.path, path),
      ),
    );
    const accepts = (other: number, r: Refusal): boolean => {
      const type = properties[other]!.get(r.path[path.length]!);
      if (type === undefined) return false;
      return (
        r.kind === "unexpected" ||
        (r.kind === "invalid-value" && Schema.is(Schema.make(type))(r.actual))
      );
    };
    const notChosen = (self: number): boolean =>
      shapeMisses[self]!.length > 0 &&
      deeper.some(
        (_, other) => other !== self && shapeMisses[self]!.every((r) => accepts(other, r)),
      );
    const chosen = deeper.filter((_, i) => !notChosen(i));
    return (chosen.length > 0 ? chosen : deeper).flatMap(({ refusals }) => refusals);
  }
  const shallow = refused.map(([refusal]) => refusal as Extract<Refusal, { kind: ValueKind }>);
  const parts = dedupe(shallow.flatMap((r) => unionParts.get(r) ?? [r.expected]));
  const literal = shallow.every((r) => r.kind === "invalid-value");
  const refusal: Refusal = {
    kind: literal ? "invalid-value" : "invalid-type",
    path,
    expected: unionText(parts, literal),
    actual: shallow[0]!.actual,
    message: shallow.find((r) => r.message !== null)?.message ?? null,
  };
  unionParts.set(refusal, parts);
  return [refusal];
}

// A struct member's property types by key, seen through the nodes that do not decide
// the kind. Empty for any other member.
function propertiesOf(member: ParseResult.ParseIssue): ReadonlyMap<PropertyKey, SchemaAST.AST> {
  const core = member instanceof ParseResult.Composite ? lookThrough(member.ast) : undefined;
  if (core === undefined || !SchemaAST.isTypeLiteral(core)) return new Map();
  return new Map(core.propertySignatures.map((p) => [p.name, p.type] as const));
}

function samePrefix(path: RefusalPath, prefix: RefusalPath): boolean {
  return prefix.every((segment, i) => segment === path[i]);
}

function samePath(a: RefusalPath, b: RefusalPath): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

function dedupe(labels: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(labels)];
}

// A union's label: the literals alone (`"a" | "b"`), the single label left
// after removing duplicates, or `one of …`.
function unionText(parts: ReadonlyArray<string>, literal: boolean): string {
  if (parts.length === 1) return parts[0]!;
  const joined = parts.join(" | ");
  return literal ? joined : `one of ${joined}`;
}

// ---------------------------------------------------------------------------
// Kinds and labels.
// ---------------------------------------------------------------------------

// The kind and label of the node an issue is about.
function describe(issue: ParseResult.ParseIssue): Described {
  if (issue instanceof ParseResult.Refinement && issue.kind === "Predicate") {
    return { kind: "filter", expected: filterLabel(issue.ast) };
  }
  if (
    issue instanceof ParseResult.Refinement ||
    issue instanceof ParseResult.Transformation ||
    issue instanceof ParseResult.Pointer
  ) {
    return describe(issue.issue);
  }
  if (issue instanceof ParseResult.Missing || issue instanceof ParseResult.Unexpected) {
    return { kind: "invalid-type", expected: "never" };
  }
  // A Type, a Composite or a Forbidden issue: its own AST.
  if (SchemaAST.isRefinement(issue.ast)) {
    return { kind: "filter", expected: filterLabel(issue.ast) };
  }
  // A transformation that failed (`NumberFromString` given "x") is named by
  // what it decodes into, never by its identifier or Effect's reason; one
  // that decodes into anything (`parseJson`) keeps the label of its input.
  if (issue instanceof ParseResult.Type && SchemaAST.isTransformation(issue.ast)) {
    const into = labelOf(issue.ast.to);
    if (into !== "unknown" && into !== "any") return { kind: "invalid-type", expected: into };
  }
  return {
    kind: isLiteralAst(issue.ast) ? "invalid-value" : "invalid-type",
    expected: labelOf(issue.ast),
  };
}

// What a type is called, by the label rules: (1) a whole type by its kind,
// (3) a built-in filter by its constraint data, (4) an identifier, (5) a
// literal's JSON text or a keyword's name. A title or a description never
// labels. Refinement, Transformation, Suspend and Declaration are looked
// through to the side that decides the kind.
function labelOf(ast: SchemaAST.AST): string {
  const whole = wholeTypeLabel(ast);
  if (whole !== undefined) return whole;
  if (SchemaAST.isRefinement(ast)) {
    return builtinFilterLabel(ast) ?? identifierOf(ast) ?? labelOf(ast.from);
  }
  if (SchemaAST.isTransformation(ast)) return identifierOf(ast) ?? labelOf(ast.from);
  if (SchemaAST.isSuspend(ast)) return labelOf(ast.f());
  if (SchemaAST.isDeclaration(ast)) {
    const [parameter, ...others] = ast.typeParameters;
    return (
      identifierOf(ast) ??
      (parameter !== undefined && others.length === 0 ? labelOf(parameter) : "<declaration schema>")
    );
  }
  return identifierOf(ast) ?? leafLabel(ast);
}

// A whole type's kind, seen through the nodes that do not decide it.
function wholeTypeLabel(ast: SchemaAST.AST): string | undefined {
  const core = lookThrough(ast);
  if (SchemaAST.isTypeLiteral(core)) return "an object";
  if (SchemaAST.isTupleType(core)) {
    // A tuple with a rest element (`NonEmptyArray`, `[A, ...A[]]`) is an array to its reader.
    return core.elements.length === 0 || core.rest.length > 0 ? "an array" : "a tuple";
  }
  if (SchemaAST.isUnion(core)) {
    return unionText(dedupe(core.types.flatMap(unionLabelParts)), core.types.every(isLiteralAst));
  }
  return undefined;
}

function unionLabelParts(ast: SchemaAST.AST): ReadonlyArray<string> {
  const core = lookThrough(ast);
  return SchemaAST.isUnion(core) ? core.types.flatMap(unionLabelParts) : [labelOf(ast)];
}

// The node that decides a type's kind: the decoded-from side of a
// refinement or a transformation, a suspension's target, a declaration's
// single type parameter (a class's fields).
function lookThrough(ast: SchemaAST.AST): SchemaAST.AST {
  if (SchemaAST.isRefinement(ast) || SchemaAST.isTransformation(ast)) return lookThrough(ast.from);
  if (SchemaAST.isSuspend(ast)) return lookThrough(ast.f());
  if (SchemaAST.isDeclaration(ast)) {
    const [parameter, ...others] = ast.typeParameters;
    return parameter !== undefined && others.length === 0 ? lookThrough(parameter) : ast;
  }
  return ast;
}

function isLiteralAst(ast: SchemaAST.AST): boolean {
  const core = lookThrough(ast);
  if (SchemaAST.isUnion(core)) return core.types.every(isLiteralAst);
  // `undefined` reads as a literal beside the others (`"a" | "b" | undefined`), as `null` does
  // (operator, 2026-11-09).
  return (
    SchemaAST.isLiteral(core) ||
    SchemaAST.isUniqueSymbol(core) ||
    SchemaAST.isEnums(core) ||
    SchemaAST.isUndefinedKeyword(core)
  );
}

// A keyword's name, in the words Effect 3 prints for it.
const KEYWORDS: ReadonlyArray<readonly [(ast: SchemaAST.AST) => boolean, string]> = [
  [SchemaAST.isStringKeyword, "string"],
  [SchemaAST.isNumberKeyword, "number"],
  [SchemaAST.isBooleanKeyword, "boolean"],
  [SchemaAST.isBigIntKeyword, "bigint"],
  [SchemaAST.isSymbolKeyword, "symbol"],
  [SchemaAST.isObjectKeyword, "object"],
  [SchemaAST.isUndefinedKeyword, "undefined"],
  [SchemaAST.isVoidKeyword, "void"],
  [SchemaAST.isNeverKeyword, "never"],
  [SchemaAST.isUnknownKeyword, "unknown"],
  [SchemaAST.isAnyKeyword, "any"],
];

function leafLabel(ast: SchemaAST.AST): string {
  if (SchemaAST.isLiteral(ast)) return literalText(ast.literal);
  if (SchemaAST.isUniqueSymbol(ast)) return String(ast.symbol);
  if (SchemaAST.isEnums(ast)) return ast.enums.map(([, value]) => literalText(value)).join(" | ");
  if (SchemaAST.isTemplateLiteral(ast)) {
    const spans = ast.spans.map((span) => `\${${labelOf(span.type)}}${span.literal}`).join("");
    return `\`${ast.head}${spans}\``;
  }
  // Whole types and the nodes looked through never reach the fallback (labelOf).
  return KEYWORDS.find(([is]) => is(ast))?.[1] ?? "unknown";
}

function literalText(literal: SchemaAST.LiteralValue): string {
  if (typeof literal === "string") return JSON.stringify(literal);
  if (typeof literal === "bigint") return `${String(literal)}n`;
  return String(literal);
}

function identifierOf(ast: SchemaAST.Annotated): string | undefined {
  return Option.getOrUndefined(SchemaAST.getIdentifierAnnotation(ast));
}

// A failed filter's label: a built-in filter from its constraint data, then
// its identifier, then `{ <from> | filter }` for one of phax's own.
function filterLabel(ast: SchemaAST.Refinement): string {
  return builtinFilterLabel(ast) ?? identifierOf(ast) ?? `{ ${labelOf(ast.from)} | filter }`;
}

// A built-in filter's label, in the words Effect 3 gives each constraint by
// default, read from the filter's schema id and its parameters (the pattern's
// regex, the bounds of its JSON Schema annotation), never from its
// description. Undefined for a filter that is not built in, or whose
// parameters cannot be read.
function builtinFilterLabel(ast: SchemaAST.Refinement): string | undefined {
  // Read directly: `SchemaAST.getSchemaIdAnnotation` exists only from effect 3.14.2, and the
  // declared range (`^3.14.0`) admits older releases.
  const id = ast.annotations[SchemaAST.SchemaIdAnnotationId];
  if (id === undefined) return undefined;
  if (id === Schema.PatternSchemaId) {
    const pattern = ast.annotations[Schema.PatternSchemaId] as
      | { readonly regex?: unknown }
      | undefined;
    return pattern?.regex instanceof RegExp
      ? `a string matching the pattern ${pattern.regex.source}`
      : undefined;
  }
  const bound = jsonSchemaNumbers(ast);
  switch (id) {
    case Schema.MinLengthSchemaId:
      // A minimum of one keeps the words phax printed on Effect 3 (operator, 2026-11-09).
      return withBound(bound.minLength, (n) =>
        n === 1 ? "a non empty string" : `a string at least ${n} character(s) long`,
      );
    case Schema.MaxLengthSchemaId:
      return withBound(bound.maxLength, (n) => `a string at most ${n} character(s) long`);
    case Schema.LengthSchemaId:
      if (bound.minLength === undefined || bound.maxLength === undefined) return undefined;
      if (bound.minLength === bound.maxLength) {
        return bound.minLength === 1
          ? "a single character"
          : `a string ${bound.minLength} character(s) long`;
      }
      return `a string at least ${bound.minLength} character(s) and at most ${bound.maxLength} character(s) long`;
    case Schema.MinItemsSchemaId:
      return withBound(bound.minItems, (n) => `an array of at least ${n} item(s)`);
    case Schema.MaxItemsSchemaId:
      return withBound(bound.maxItems, (n) => `an array of at most ${n} item(s)`);
    case Schema.ItemsCountSchemaId:
      return withBound(bound.minItems, (n) => `an array of exactly ${n} item(s)`);
    case Schema.GreaterThanSchemaId:
      return withBound(bound.exclusiveMinimum, (n) =>
        n === 0 ? "a positive number" : `a number greater than ${n}`,
      );
    case Schema.GreaterThanOrEqualToSchemaId:
      return withBound(bound.minimum, (n) =>
        n === 0 ? "a non-negative number" : `a number greater than or equal to ${n}`,
      );
    case Schema.LessThanSchemaId:
      return withBound(bound.exclusiveMaximum, (n) =>
        n === 0 ? "a negative number" : `a number less than ${n}`,
      );
    case Schema.LessThanOrEqualToSchemaId:
      return withBound(bound.maximum, (n) =>
        n === 0 ? "a non-positive number" : `a number less than or equal to ${n}`,
      );
    case Schema.BetweenSchemaId:
      return bound.minimum === undefined || bound.maximum === undefined
        ? undefined
        : `a number between ${bound.minimum} and ${bound.maximum}`;
    case Schema.MultipleOfSchemaId:
      return withBound(bound.multipleOf, (n) => `a number divisible by ${n}`);
    case Schema.IntSchemaId:
      return "an integer";
    case Schema.FiniteSchemaId:
      return "a finite number";
    case Schema.NonNaNSchemaId:
      return "a number excluding NaN";
    default:
      return undefined;
  }
}

function withBound(n: number | undefined, label: (n: number) => string): string | undefined {
  return n === undefined ? undefined : label(n);
}

const BOUND_KEYS = [
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

type Bounds = { readonly [K in (typeof BOUND_KEYS)[number]]: number | undefined };

// The numeric constraints a built-in filter records in its JSON Schema annotation.
function jsonSchemaNumbers(ast: SchemaAST.Refinement): Bounds {
  const annotation: unknown = Option.getOrUndefined(SchemaAST.getJSONSchemaAnnotation(ast));
  const record =
    typeof annotation === "object" && annotation !== null
      ? (annotation as Readonly<Record<string, unknown>>)
      : {};
  const read = (key: (typeof BOUND_KEYS)[number]): number | undefined => {
    const value = record[key];
    return typeof value === "number" ? value : undefined;
  };
  return {
    minLength: read("minLength"),
    maxLength: read("maxLength"),
    minItems: read("minItems"),
    maxItems: read("maxItems"),
    minimum: read("minimum"),
    maximum: read("maximum"),
    exclusiveMinimum: read("exclusiveMinimum"),
    exclusiveMaximum: read("exclusiveMaximum"),
    multipleOf: read("multipleOf"),
  };
}

// ---------------------------------------------------------------------------
// Messages. Mirrors `getCurrentMessage` and `getMessage` in
// effect/src/ParseResult.ts: a `message` annotation on the issue's AST, which
// a Composite, a From refinement and a non-Transformation transformation pass
// to their inner issue unless it overrides.
// ---------------------------------------------------------------------------

type CurrentMessage = { readonly message: string; readonly override: boolean };

function currentMessage(issue: ParseResult.ParseIssue): CurrentMessage | undefined {
  if (
    issue instanceof ParseResult.Pointer ||
    issue instanceof ParseResult.Unexpected ||
    issue instanceof ParseResult.Missing
  ) {
    return undefined;
  }
  const annotation = Option.getOrUndefined(SchemaAST.getMessageAnnotation(issue.ast));
  if (annotation === undefined) return undefined;
  const answer = annotation(issue);
  if (typeof answer === "string") return { message: answer, override: false };
  if (Effect.isEffect(answer)) return { message: Effect.runSync(answer), override: false };
  const message =
    typeof answer.message === "string" ? answer.message : Effect.runSync(answer.message);
  return { message, override: answer.override };
}

function messageOf(issue: ParseResult.ParseIssue): string | undefined {
  const current = currentMessage(issue);
  if (current === undefined) return undefined;
  if (current.override) return current.message;
  if (issue instanceof ParseResult.Composite) return undefined;
  if (
    (issue instanceof ParseResult.Refinement && issue.kind === "From") ||
    (issue instanceof ParseResult.Transformation && issue.kind !== "Transformation")
  ) {
    return messageOf(issue.issue);
  }
  return current.message;
}

// The text one of phax's own filters returned for this issue (`return "…"` or
// `{ path, message }`), carried by a Type issue on the filter's refinement.
// Effect's built-in filters return booleans, so this is never Effect's text.
function filterText(issue: ParseResult.Type): string | undefined {
  return SchemaAST.isRefinement(issue.ast) ? issue.message : undefined;
}

// phax's own `missingMessage` annotation on the missing key's signature.
function missingMessageOf(issue: ParseResult.Missing): string | undefined {
  const annotation = Option.getOrUndefined(SchemaAST.getMissingMessageAnnotation(issue.ast));
  if (annotation === undefined) return undefined;
  const answer = annotation();
  return typeof answer === "string" ? answer : Effect.runSync(answer);
}
