import { Predicate, Schema, SchemaAST, SchemaIssue } from "effect";
import type { Refusal, RefusalPath } from "./model.js";

/**
 * The refusals of a decode failure, in the order of the issue tree's leaves
 * (`SchemaIssue.makeFormatterStandardSchemaV1`'s order) and at their paths.
 * This is the only module that reads Effect's issues.
 *
 * It walks the `SchemaIssue` tree and builds every label itself: it never
 * calls a formatter and never reads the text Effect writes for an issue. The
 * refused value is the issue's reported input, so a decoder whose failure
 * reaches this module decodes with `reportInput: true`. Two departures from
 * the plain list of leaves, both about unions: a union whose every member
 * refused at its own path is one refusal, and a union where some member got
 * deeper drops the members that did not.
 */
export function refusalsOf(error: Schema.SchemaError): ReadonlyArray<Refusal> {
  return walk(error.issue, [], undefined);
}

/** The first of `refusalsOf(error)`, or `undefined` when there is none. */
export function firstRefusal(error: Schema.SchemaError): Refusal | undefined {
  return refusalsOf(error)[0];
}

/**
 * phax's own refusal text, computed from the refused value: the line rendered
 * instead of `Expected <label>, actual <value>`. On a check (`isPattern(re,
 * refusalMessage(…))`), for that check's failures; on a node without checks
 * (`Schema.Boolean.annotate(refusalMessage(…))`), for a value of the wrong type.
 * A static text needs none of this: Effect's own `message` annotation carries it.
 */
export function refusalMessage(message: (actual: unknown) => string): {
  readonly [REFUSAL_MESSAGE]: (actual: unknown) => string;
} {
  return { [REFUSAL_MESSAGE]: message };
}

/**
 * phax's own refusal text for every value refusal of the annotated node (a
 * wrong type, a literal it misses, a check it fails), computed from the
 * refused value: one refusal that names the node, with this text.
 */
export function refusalOverride(message: (actual: unknown) => string): {
  readonly [REFUSAL_OVERRIDE]: (actual: unknown) => string;
} {
  return { [REFUSAL_OVERRIDE]: message };
}

const REFUSAL_MESSAGE = "phaxRefusalMessage";
const REFUSAL_OVERRIDE = "phaxRefusalOverride";

type ValueKind = "invalid-type" | "invalid-value" | "filter";

// The kind and label of the node a value refusal is about.
type Described = { readonly kind: ValueKind; readonly expected: string };

// ---------------------------------------------------------------------------
// The tree walk. `owner` is the AST of the Composite that holds the current
// Pointer or Filter: the struct or tuple an unexpected key is labelled from,
// the checked node a filter is labelled against.
// ---------------------------------------------------------------------------

function walk(
  issue: SchemaIssue.Issue,
  path: RefusalPath,
  owner: SchemaAST.AST | undefined,
): ReadonlyArray<Refusal> {
  if (issue instanceof SchemaIssue.Pointer) {
    return walk(issue.issue, [...path, ...issue.path], owner);
  }
  if (issue instanceof SchemaIssue.MissingKey) {
    const message = issue.annotations?.messageMissingKey;
    return [message === undefined ? { kind: "missing", path } : { kind: "missing", path, message }];
  }
  if (issue instanceof SchemaIssue.UnexpectedKey) return [unexpectedRefusal(issue, path)];
  if (issue instanceof SchemaIssue.Forbidden) {
    return [
      {
        kind: "invalid-value",
        path,
        expected: "a value decoded synchronously",
        actual: inputOf(issue),
        message: null,
      },
    ];
  }
  if (issue instanceof SchemaIssue.InvalidType) {
    const actual = inputOf(issue);
    const message =
      overrideOf(issue.ast, actual) ??
      dynamicMessage(issue.ast.annotations, actual) ??
      ownMessage(issue.ast);
    return [valueRefusal(describeType(issue.ast), path, actual, message)];
  }
  if (issue instanceof SchemaIssue.InvalidValue) {
    // A value a transformation or a filter refused, outside a node that names it.
    return [
      {
        kind: "invalid-value",
        path,
        expected: owner === undefined ? "unknown" : labelOf(owner),
        actual: inputOf(issue),
        message: issue.annotations?.message ?? null,
      },
    ];
  }
  if (issue instanceof SchemaIssue.OneOf) {
    return [valueRefusal(describeType(issue.ast), path, inputOf(issue), null)];
  }
  if (issue instanceof SchemaIssue.Filter) return filterRefusals(issue, path, owner);
  if (issue instanceof SchemaIssue.Encoding) return encodingRefusals(issue, path);
  if (issue instanceof SchemaIssue.Composite) {
    const override = overrideOf(issue.ast, inputOf(issue));
    if (override === undefined) {
      // A node's failed checks: the first alone, as a chain of refinements stops at the
      // first that fails, whatever the decode's `errors` option.
      const members = issue.issues.every((member) => member instanceof SchemaIssue.Filter)
        ? issue.issues.slice(0, 1)
        : issue.issues;
      return members.flatMap((member) => walk(member, path, issue.ast));
    }
    // One refusal naming the node: its failed check, or its type.
    const [first] = issue.issues;
    const described: Described =
      first instanceof SchemaIssue.Filter
        ? { kind: "filter", expected: filterLabel(first.filter, issue.ast) }
        : describeType(issue.ast);
    return [valueRefusal(described, path, inputOf(issue), override)];
  }
  // An AnyOf: a union no member took.
  const override = overrideOf(issue.ast, inputOf(issue));
  if (override !== undefined) {
    return [valueRefusal(describeType(issue.ast), path, inputOf(issue), override)];
  }
  return unionRefusals(issue, path);
}

// The value an issue refused: its reported input.
function inputOf(issue: SchemaIssue.Issue): unknown {
  return SchemaIssue.hasInput(issue) ? issue.input : undefined;
}

function valueRefusal(
  { kind, expected }: Described,
  path: RefusalPath,
  actual: unknown,
  message: string | null | undefined,
): Refusal {
  return { kind, path, expected, actual, message: message ?? null };
}

function unexpectedRefusal(issue: SchemaIssue.UnexpectedKey, path: RefusalPath): Refusal {
  const owner = issue.ast;
  if (SchemaAST.isObjects(owner) || SchemaAST.isArrays(owner)) {
    return { kind: "unexpected", path, expected: allowedKeysLabel(owner) };
  }
  // Only phax builds an UnexpectedKey outside a struct or a tuple (the plan
  // front matter's `completes-spec` beside `source-spec: null`), so its text
  // is phax's own.
  const text = owner.annotations?.["messageUnexpectedKey"];
  return typeof text === "string"
    ? { kind: "unexpected", path, expected: "never", message: text }
    : { kind: "unexpected", path, expected: "never" };
}

// The keys a struct or tuple allows: a struct's index signature parameters
// then its property names, a tuple's element indices, joined by ` | `,
// `never` when there is none.
function allowedKeysLabel(owner: SchemaAST.Objects | SchemaAST.Arrays): string {
  const parts = SchemaAST.isObjects(owner)
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
// Filters and transformations.
// ---------------------------------------------------------------------------

// A failed check of `owner`, the node the Composite holding it checked.
function filterRefusals(
  issue: SchemaIssue.Filter,
  path: RefusalPath,
  owner: SchemaAST.AST | undefined,
): ReadonlyArray<Refusal> {
  // A check may fail at a path inside the value (`{ path, issue }`).
  let inner = issue.issue;
  let at = path;
  while (inner instanceof SchemaIssue.Pointer) {
    at = [...at, ...inner.path];
    inner = inner.issue;
  }
  if (!(inner instanceof SchemaIssue.InvalidValue)) return walk(inner, at, owner);
  const actual = SchemaIssue.hasInput(inner) ? inner.input : inputOf(issue);
  const message =
    dynamicMessage(issue.filter.annotations, actual) ??
    issue.filter.annotations?.message ??
    inner.annotations?.message ??
    null;
  return [
    {
      kind: "filter",
      path: at,
      expected: filterLabel(issue.filter, owner),
      actual,
      message,
    },
  ];
}

// A transformation's failure. One whose encoded side refused the value is that
// side's refusal. One that failed to transform the value is named by what it
// decodes into, never by its identifier or Effect's reason; one that decodes
// into anything (`fromJsonString(Unknown)`) keeps the label of its input.
function encodingRefusals(issue: SchemaIssue.Encoding, path: RefusalPath): ReadonlyArray<Refusal> {
  const inner = issue.issue;
  if (!isTransformationFailure(inner)) return walk(inner, path, undefined);
  const into = labelOf(SchemaAST.toType(issue.ast));
  const expected =
    into !== "unknown" && into !== "any" ? into : labelOf(SchemaAST.toEncoded(issue.ast));
  return [{ kind: "invalid-type", path, expected, actual: inputOf(issue), message: null }];
}

// The checks Effect's own string codecs run on their encoded side
// (`BigIntFromString` refusing "1.5"): part of the transformation, not a
// filter of the schema's author.
const CODEC_CHECKS: ReadonlySet<string> = new Set([
  "effect/schema/isStringBigInt",
  "effect/schema/isStringFinite",
  "effect/schema/isStringSymbol",
]);

function isTransformationFailure(issue: SchemaIssue.Issue): boolean {
  if (issue instanceof SchemaIssue.InvalidValue || issue instanceof SchemaIssue.Forbidden) {
    return true;
  }
  return (
    issue instanceof SchemaIssue.Composite &&
    issue.issues.every(
      (member) =>
        member instanceof SchemaIssue.Filter &&
        CODEC_CHECKS.has(member.filter.annotations?.representation?.id ?? ""),
    )
  );
}

// ---------------------------------------------------------------------------
// Unions.
// ---------------------------------------------------------------------------

function unionRefusals(issue: SchemaIssue.AnyOf, path: RefusalPath): ReadonlyArray<Refusal> {
  const input = inputOf(issue);
  // No member took the value: the union's own refusal, or its tags'.
  if (issue.issues.length === 0) {
    return tagRefusals(issue.ast, input, path) ?? [wholeUnionRefusal(issue.ast, path, input)];
  }
  const refused = issue.issues.map((member) => walk(member, path, undefined));
  const isShallow = (refusals: ReadonlyArray<Refusal>): boolean =>
    refusals.length === 1 &&
    samePath(refusals[0]!.path, path) &&
    (refusals[0]!.kind === "invalid-type" || refusals[0]!.kind === "invalid-value");
  // Every member refused at the union's own path: one refusal naming them all.
  if (refused.every(isShallow)) return [wholeUnionRefusal(issue.ast, path, input, refused)];
  // Members told apart by their keys (`outcome: "committed" | "failed"`, a key only one
  // variant declares). A member refused on a key of its own, a literal the value misses
  // or a key it does not declare, is not the one the input chose when another member
  // declares each such key and its type there accepts the input's value. Its line
  // (`outcome: Expected "failed"`) then gives way to the chosen member's
  // (`arbitrated: is missing`). When no member is left, every deeper member's refusals
  // stay, in the members' order.
  const deeper = issue.issues.flatMap((member, i) =>
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
    deeper.some((_, other) => other !== self && shapeMisses[self]!.every((r) => accepts(other, r)));
  const chosen = deeper.filter((_, i) => !notChosen(i));
  return (chosen.length > 0 ? chosen : deeper).flatMap(({ refusals }) => refusals);
}

// The union's one refusal when no member got past the union's own path: every
// member named as a value of the wrong type names it (a nested union's members
// flattened), the literals alone (`"a" | "b"`) or `one of …`. The first member
// that refused there with a message carries it.
function wholeUnionRefusal(
  ast: SchemaAST.Union,
  path: RefusalPath,
  actual: unknown,
  refused: ReadonlyArray<ReadonlyArray<Refusal>> = [],
): Refusal {
  const parts = dedupe(memberTypeLabels(ast));
  const literal = ast.types.every(isLiteralAst);
  let message: string | null = null;
  for (const refusal of refused.flat()) {
    if (refusal.kind !== "missing" && refusal.kind !== "unexpected" && refusal.message !== null) {
      message = refusal.message;
      break;
    }
  }
  return {
    kind: literal ? "invalid-value" : "invalid-type",
    path,
    expected: unionText(parts, literal),
    actual,
    message,
  };
}

function memberTypeLabels(ast: SchemaAST.AST): ReadonlyArray<string> {
  const core = lookThrough(ast);
  return SchemaAST.isUnion(core)
    ? core.types.flatMap(memberTypeLabels)
    : [describeType(ast).expected];
}

// A union of objects told apart by tags (keys whose type is a literal in each member
// declaring them), given an object no member's tags select: the tags it misses, each
// naming the literals the members declare there. Undefined when the union has no tags
// or the value is not an object.
function tagRefusals(
  ast: SchemaAST.Union,
  input: unknown,
  path: RefusalPath,
): ReadonlyArray<Refusal> | undefined {
  if (!Predicate.isReadonlyObject(input)) return undefined;
  const tags = new Map<PropertyKey, Array<SchemaAST.Literal>>();
  for (const member of ast.types) {
    const core = lookThrough(member);
    if (!SchemaAST.isObjects(core)) return undefined;
    for (const signature of core.propertySignatures) {
      const type = lookThrough(signature.type);
      if (!SchemaAST.isLiteral(type) || SchemaAST.isOptional(signature.type)) continue;
      const literals = tags.get(signature.name) ?? [];
      if (!literals.some((l) => l.literal === type.literal)) literals.push(type);
      tags.set(signature.name, literals);
    }
  }
  if (tags.size === 0) return undefined;
  const refusals: Array<Refusal> = [];
  for (const [key, literals] of tags) {
    if (!Object.hasOwn(input, key)) {
      refusals.push({ kind: "missing", path: [...path, key] });
      continue;
    }
    const value = input[key];
    if (literals.some((l) => l.literal === value)) continue;
    const parts = literals.map((l) => literalText(l.literal));
    refusals.push({
      kind: "invalid-value",
      path: [...path, key],
      expected: unionText(parts, true),
      actual: value,
      message: null,
    });
  }
  return refusals.length > 0 ? refusals : undefined;
}

// A struct member's property types by key, seen through the nodes that do not decide
// the kind. Empty for any other member.
function propertiesOf(member: SchemaIssue.Issue): ReadonlyMap<PropertyKey, SchemaAST.AST> {
  const ast =
    member instanceof SchemaIssue.Composite || member instanceof SchemaIssue.Encoding
      ? member.ast
      : undefined;
  const core = ast === undefined ? undefined : lookThrough(ast);
  if (core === undefined || !SchemaAST.isObjects(core)) return new Map();
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

// The kind and label of a node that refused the value's type: the node
// without its checks, which only run on a value of the right type.
function describeType(ast: SchemaAST.AST): Described {
  return {
    kind: isLiteralAst(ast) ? "invalid-value" : "invalid-type",
    expected: labelOf(ast, false),
  };
}

// What a type is called, by the label rules: (1) a whole type by its kind,
// (3) a built-in check by its constraint data, (4) an identifier, (5) a
// literal's JSON text or a keyword's name. A title or a description never
// labels. Checks (unless `withChecks` is false), encodings, suspensions and
// declarations are looked through to the side that decides the kind.
function labelOf(ast: SchemaAST.AST, withChecks = true): string {
  const whole = wholeTypeLabel(ast);
  if (whole !== undefined) return whole;
  const checks = ast.checks;
  if (withChecks && checks !== undefined) {
    for (let i = checks.length - 1; i >= 0; i--) {
      const check = checks[i]!;
      const label = checkLabel(check, ast) ?? checkIdentifier(check);
      if (label !== undefined) return label;
    }
  }
  if (ast.encoding !== undefined) {
    return identifierOf(ast) ?? labelOf(SchemaAST.toEncoded(ast));
  }
  if (SchemaAST.isSuspend(ast)) return labelOf(ast.thunk());
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
  if (SchemaAST.isObjects(core)) return "an object";
  if (SchemaAST.isArrays(core)) {
    // An array with a rest element (`NonEmptyArray`, `[A, ...A[]]`) is an array to its reader.
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

// The node that decides a type's kind: the encoded side of a transformation,
// a suspension's target, a declaration's single type parameter (a class's
// fields). Checks never decide it.
function lookThrough(ast: SchemaAST.AST): SchemaAST.AST {
  if (ast.encoding !== undefined) return lookThrough(SchemaAST.toEncoded(ast));
  if (SchemaAST.isSuspend(ast)) return lookThrough(ast.thunk());
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
    SchemaAST.isEnum(core) ||
    SchemaAST.isUndefined(core) ||
    SchemaAST.isNull(core)
  );
}

// A keyword's name, in the words phax prints for it.
const KEYWORDS: ReadonlyArray<readonly [(ast: SchemaAST.AST) => boolean, string]> = [
  [SchemaAST.isString, "string"],
  [SchemaAST.isNumber, "number"],
  [SchemaAST.isBoolean, "boolean"],
  [SchemaAST.isBigInt, "bigint"],
  [SchemaAST.isSymbol, "symbol"],
  [SchemaAST.isObjectKeyword, "object"],
  [SchemaAST.isUndefined, "undefined"],
  [SchemaAST.isVoid, "void"],
  [SchemaAST.isNever, "never"],
  [SchemaAST.isUnknown, "unknown"],
  [SchemaAST.isAny, "any"],
  [SchemaAST.isNull, "null"],
];

function leafLabel(ast: SchemaAST.AST): string {
  if (SchemaAST.isLiteral(ast)) return literalText(ast.literal);
  if (SchemaAST.isUniqueSymbol(ast)) return String(ast.symbol);
  if (SchemaAST.isEnum(ast)) return ast.enums.map(([, value]) => literalText(value)).join(" | ");
  if (SchemaAST.isTemplateLiteral(ast)) {
    const parts = ast.parts
      .map((part) => (SchemaAST.isLiteral(part) ? String(part.literal) : `\${${labelOf(part)}}`))
      .join("");
    return `\`${parts}\``;
  }
  // Whole types and the nodes looked through never reach the fallback (labelOf).
  return KEYWORDS.find(([is]) => is(ast))?.[1] ?? "unknown";
}

function literalText(literal: SchemaAST.LiteralValue | symbol): string {
  if (typeof literal === "string") return JSON.stringify(literal);
  if (typeof literal === "bigint") return `${String(literal)}n`;
  return String(literal);
}

function identifierOf(ast: SchemaAST.AST): string | undefined {
  const identifier = ast.annotations?.["identifier"];
  return typeof identifier === "string" ? identifier : undefined;
}

function checkIdentifier(check: SchemaAST.Check<never>): string | undefined {
  const identifier = check.annotations?.identifier;
  return typeof identifier === "string" ? identifier : undefined;
}

// A failed check's label: a built-in check from its constraint data, then its
// identifier, then `{ <checked node> | filter }` for one of phax's own.
function filterLabel(check: SchemaAST.Filter<never>, owner: SchemaAST.AST | undefined): string {
  return (
    checkLabel(check, owner) ??
    checkIdentifier(check) ??
    `{ ${owner === undefined ? "unknown" : labelOf(owner, false)} | filter }`
  );
}

// A built-in check's label, in the words phax gives each constraint, read
// from the check's representation (its id and payload) and the kind of the
// node it checks, never from its description or Effect's `expected` text.
// Undefined for a check that is not built in, or whose payload cannot be read.
function checkLabel(
  check: SchemaAST.Check<never>,
  base: SchemaAST.AST | undefined,
): string | undefined {
  const representation = check.annotations?.representation;
  if (representation === undefined) return undefined;
  const payload = numbers(representation.payload);
  const core = base === undefined ? undefined : lookThrough(base);
  const onArray = core !== undefined && SchemaAST.isArrays(core);
  switch (representation.id) {
    case "effect/schema/isPattern": {
      const source = strings(representation.payload)["source"];
      return source === undefined ? undefined : `a string matching the pattern ${source}`;
    }
    case "effect/schema/isMinLength":
      // A minimum of one keeps the words phax printed on Effect 3 (operator, 2026-11-09).
      return withBound(payload["minLength"], (n) =>
        onArray
          ? `an array of at least ${n} item(s)`
          : n === 1
            ? "a non empty string"
            : `a string at least ${n} character(s) long`,
      );
    case "effect/schema/isMaxLength":
      return withBound(payload["maxLength"], (n) =>
        onArray ? `an array of at most ${n} item(s)` : `a string at most ${n} character(s) long`,
      );
    case "effect/schema/isBetweenLength": {
      const minimum = payload["minimum"];
      const maximum = payload["maximum"];
      if (minimum === undefined || maximum === undefined) return undefined;
      if (onArray) {
        return minimum === maximum ? `an array of exactly ${minimum} item(s)` : undefined;
      }
      if (minimum === maximum) {
        return minimum === 1 ? "a single character" : `a string ${minimum} character(s) long`;
      }
      return `a string at least ${minimum} character(s) and at most ${maximum} character(s) long`;
    }
    case "effect/schema/isGreaterThan":
      return withBound(payload["exclusiveMinimum"], (n) =>
        n === 0 ? "a positive number" : `a number greater than ${n}`,
      );
    case "effect/schema/isGreaterThanOrEqualTo":
      return withBound(payload["minimum"], (n) =>
        n === 0 ? "a non-negative number" : `a number greater than or equal to ${n}`,
      );
    case "effect/schema/isLessThan":
      return withBound(payload["exclusiveMaximum"], (n) =>
        n === 0 ? "a negative number" : `a number less than ${n}`,
      );
    case "effect/schema/isLessThanOrEqualTo":
      return withBound(payload["maximum"], (n) =>
        n === 0 ? "a non-positive number" : `a number less than or equal to ${n}`,
      );
    case "effect/schema/isBetween": {
      const minimum = payload["minimum"];
      const maximum = payload["maximum"];
      return minimum === undefined || maximum === undefined
        ? undefined
        : `a number between ${minimum} and ${maximum}`;
    }
    case "effect/schema/isMultipleOf":
      return withBound(payload["divisor"], (n) => `a number divisible by ${n}`);
    case "effect/schema/isInt":
      return "an integer";
    case "effect/schema/isFinite":
      return "a finite number";
    default:
      return undefined;
  }
}

function withBound(n: number | undefined, label: (n: number) => string): string | undefined {
  return n === undefined ? undefined : label(n);
}

// A check payload's numeric and string fields, by name.
function numbers(payload: unknown): Readonly<Record<string, number | undefined>> {
  return fields(payload, (value) => (typeof value === "number" ? value : undefined));
}

function strings(payload: unknown): Readonly<Record<string, string | undefined>> {
  return fields(payload, (value) => (typeof value === "string" ? value : undefined));
}

function fields<A>(
  payload: unknown,
  read: (value: unknown) => A | undefined,
): Readonly<Record<string, A | undefined>> {
  if (typeof payload !== "object" || payload === null) return {};
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, read(value)]));
}

// ---------------------------------------------------------------------------
// Messages: a node's own static `message` annotation, and phax's own refusal
// texts (`refusalMessage` on a node or a check, `refusalOverride` on a node).
// ---------------------------------------------------------------------------

function ownMessage(ast: SchemaAST.AST): string | undefined {
  const message = ast.annotations?.["message"];
  return typeof message === "string" ? message : undefined;
}

// The `refusalOverride` text on the node or on one of its checks (where Effect's
// `annotate` puts it on a checked node), for the refused value.
function overrideOf(ast: SchemaAST.AST, actual: unknown): string | undefined {
  const sources = [ast.annotations, ...(ast.checks ?? []).map((check) => check.annotations)];
  for (const annotations of sources.toReversed()) {
    const text = textOf(annotations?.[REFUSAL_OVERRIDE], actual);
    if (text !== undefined) return text;
  }
  return undefined;
}

// The `refusalMessage` text in these annotations, for the refused value.
function dynamicMessage(
  annotations: Schema.Annotations.Annotations | undefined,
  actual: unknown,
): string | undefined {
  return textOf(annotations?.[REFUSAL_MESSAGE], actual);
}

function textOf(annotation: unknown, actual: unknown): string | undefined {
  if (typeof annotation !== "function") return undefined;
  const text: unknown = annotation(actual);
  return typeof text === "string" ? text : undefined;
}
