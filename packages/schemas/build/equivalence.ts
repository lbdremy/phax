// Pure judge behind the schemas check: are two JSON Schemas of one format the
// same contract? Either they are equal as parsed JSON once their annotation
// keywords are dropped, or a standard draft-07 validator (ajv) gives every
// document of a non-empty list the same verdict under both. The documents are
// the format's corpus inputs, which phax accepts and refuses alike, so a
// rendering that differs only in form (`$defs` or `definitions`, a `const` or
// a one-value `enum`) is equivalent, and one that moves a verdict is not. An
// empty list never proves equivalence.
import { isDeepStrictEqual } from "node:util";
import { Ajv } from "ajv";

/** The annotation keywords a comparison ignores. */
const ANNOTATIONS: ReadonlySet<string> = new Set(["description", "title", "examples"]);
/** Keywords whose value is one subschema. */
const SUBSCHEMA = new Set([
  "items",
  "additionalProperties",
  "not",
  "if",
  "then",
  "else",
  "contains",
  "propertyNames",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
/** Keywords whose value maps names to subschemas. */
const SUBSCHEMA_MAP = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_ARRAY = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A JSON Schema without its `description`, `title` and `examples` keywords,
 * at every (sub)schema position this walker knows. Every other keyword
 * (`enum`, `const`, `default`, `required`, …) is copied verbatim, and names
 * under `properties` and the like are kept, so a property named
 * `description` survives. A subschema under a keyword not listed here keeps
 * its annotations: compared strictly, never missed.
 */
export function withoutAnnotations(schema: unknown): unknown {
  if (!isObject(schema)) return schema;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATIONS.has(key)) continue;
    if (SUBSCHEMA.has(key)) {
      result[key] = Array.isArray(value)
        ? value.map(withoutAnnotations)
        : withoutAnnotations(value);
    } else if (SUBSCHEMA_MAP.has(key) && isObject(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, withoutAnnotations(sub)]),
      );
    } else if (SUBSCHEMA_ARRAY.has(key) && Array.isArray(value)) {
      result[key] = value.map(withoutAnnotations);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** A document the two schemas judge differently, with each schema's verdict. */
interface Disagreement {
  readonly document: unknown;
  readonly released: boolean;
  readonly generated: boolean;
}

export interface Equivalence {
  readonly equivalent: boolean;
  /** Every document whose verdict differs, in the order given. */
  readonly disagreements: ReadonlyArray<Disagreement>;
  /** Why a schema could not be judged (not a JSON Schema object, or ajv refused it), else null. */
  readonly problem: string | null;
}

type Validate = (document: unknown) => boolean;

function compile(label: string, schema: unknown): Validate | string {
  if (!isObject(schema) && typeof schema !== "boolean") {
    return `the ${label} schema is not a JSON Schema`;
  }
  try {
    const validate = new Ajv({ strict: false }).compile(schema);
    return (document) => validate(document) === true;
  } catch (error) {
    return `ajv cannot compile the ${label} schema: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Judges a format's `generated` JSON Schema against its `released` one over
 * `documents` (parsed JSON each). `equivalent` is true when the two are equal
 * once annotations are dropped, or when `documents` is not empty and no
 * document's verdict differs; `disagreements` lists the documents whose
 * verdicts differ.
 */
export function judgeEquivalence(input: {
  readonly released: unknown;
  readonly generated: unknown;
  readonly documents: ReadonlyArray<unknown>;
}): Equivalence {
  const sameShape = isDeepStrictEqual(
    withoutAnnotations(input.released),
    withoutAnnotations(input.generated),
  );
  const released = compile("released", input.released);
  const generated = compile("generated", input.generated);
  if (typeof released === "string" || typeof generated === "string") {
    return {
      equivalent: sameShape,
      disagreements: [],
      problem: typeof released === "string" ? released : String(generated),
    };
  }
  const disagreements: Disagreement[] = [];
  for (const document of input.documents) {
    const verdicts = { released: released(document), generated: generated(document) };
    if (verdicts.released !== verdicts.generated) disagreements.push({ document, ...verdicts });
  }
  return {
    equivalent: sameShape || (input.documents.length > 0 && disagreements.length === 0),
    disagreements,
    problem: null,
  };
}
