import type { ParseResult } from "effect";
import type { Refusal } from "./model.js";

/**
 * The refusals of an Effect 3 decode failure, in the order of
 * `ParseResult.ArrayFormatter.formatErrorSync`'s issues and at its paths. This
 * is the only module that reads Effect's issues.
 */
export function refusalsOf(_error: ParseResult.ParseError): ReadonlyArray<Refusal> {
  throw new Error("refusal adapter: not implemented");
}

/** The first of `refusalsOf(error)`, or `undefined` when there is none. */
export function firstRefusal(_error: ParseResult.ParseError): Refusal | undefined {
  throw new Error("refusal adapter: not implemented");
}
