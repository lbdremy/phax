import { Either, ParseResult } from "effect";

/** A document that could not be read: where it went wrong, and why. */
export type ParseFailure = {
  readonly ok: false;
  readonly error: { readonly path: string; readonly message: string };
};

/**
 * The result of reading a document (spec §6): a value, or a failure that
 * names where the document went wrong. A bad document is a value, never an
 * exception.
 */
export type Parsed<T> = { readonly ok: true; readonly value: T } | ParseFailure;

/**
 * The result of reading a format with several shapes. `M` maps each shape id
 * (`v<N>`, a release, or `next`) to that shape's value type; a success names
 * its shape and carries that shape's exact type. Assignable to
 * `Parsed<M[keyof M]>`.
 */
export type ParsedShape<M> =
  | {
      [K in keyof M & string]: { readonly ok: true; readonly shape: K; readonly value: M[K] };
    }[keyof M & string]
  | ParseFailure;

export function failure(path: string, message: string): ParseFailure {
  return { ok: false, error: { path, message } };
}

/**
 * Maps a decoder's `Either` to `Parsed`. The failure reports the first issue
 * `ArrayFormatter` yields: its path joined with `.` (`""` at the root) and
 * its message.
 */
export function fromEither<T>(result: Either.Either<T, ParseResult.ParseError>): Parsed<T> {
  if (Either.isRight(result)) return { ok: true, value: result.right };
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(result.left);
  return failure(
    first === undefined ? "" : first.path.map(String).join("."),
    first?.message ?? "invalid document",
  );
}
