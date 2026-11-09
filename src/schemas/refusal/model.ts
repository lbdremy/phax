/**
 * phax's own refusal model: what a decode refused, as a phax value. The
 * adapter (`adapter.ts`) is the one module that builds it from the installed
 * Effect's issues, and the renderer (`render.ts`) reads only this value, so a
 * change of Effect version moves the adapter and no refusal line.
 */

/** Where the refusal sits in the input: object keys and array indices, root first. */
export type RefusalPath = ReadonlyArray<PropertyKey>;

/** A required key is absent. Renders `is missing`. */
type MissingRefusal = {
  readonly kind: "missing";
  readonly path: RefusalPath;
};

/**
 * A key the shape does not declare, under a decode that refuses excess
 * properties. `expected` is the allowed keys' label: each key JSON-quoted,
 * joined by ` | ` (`"a" | "b"`). Renders `is unexpected, expected: <expected>`.
 */
type UnexpectedRefusal = {
  readonly kind: "unexpected";
  readonly path: RefusalPath;
  readonly expected: string;
};

/**
 * The value has the wrong JSON type: a string where an object was expected,
 * a number where an array was expected, a number where a union of an object
 * and null was expected.
 */
type InvalidTypeRefusal = {
  readonly kind: "invalid-type";
  readonly path: RefusalPath;
  /** The expected label: a whole type by its kind (`an object`), a keyword, an identifier, `one of …`. */
  readonly expected: string;
  readonly actual: unknown;
  /** phax's own `message` annotation text, rendered alone when set. */
  readonly message: string | null;
};

/**
 * The value has the right type but is not an allowed value: a literal, or a
 * union of literals alone (`"a" | "b"`).
 */
type InvalidValueRefusal = {
  readonly kind: "invalid-value";
  readonly path: RefusalPath;
  /** The literal's JSON text, or the literals' texts joined by ` | `. */
  readonly expected: string;
  readonly actual: unknown;
  /** phax's own `message` annotation text, rendered alone when set. */
  readonly message: string | null;
};

/**
 * A refinement refused the value: a built-in filter (pattern, minLength,
 * maxLength, minItems, …) or one of phax's own.
 */
type FilterRefusal = {
  readonly kind: "filter";
  readonly path: RefusalPath;
  /** The filter's label, from its constraint data (`a string at least 1 character(s) long`). */
  readonly expected: string;
  readonly actual: unknown;
  /** phax's own `message` annotation text, rendered alone when set. */
  readonly message: string | null;
};

export type Refusal =
  | MissingRefusal
  | UnexpectedRefusal
  | InvalidTypeRefusal
  | InvalidValueRefusal
  | FilterRefusal;
