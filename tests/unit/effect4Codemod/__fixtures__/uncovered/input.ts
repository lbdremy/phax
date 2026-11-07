import { ParseResult } from "effect";

/** The issues Effect 3 reports for a decode failure, each with its path and message. */
const formatIssues = ParseResult.ArrayFormatter.formatErrorSync;

/** The first issue of a decode failure as one line, `<path>: <message>`. */
export function firstIssueLine(failure: Parameters<typeof formatIssues>[0]): string | undefined {
  const [first] = formatIssues(failure);
  if (first === undefined) return undefined;
  return first.path.length === 0 ? first.message : `${first.path.join(".")}: ${first.message}`;
}
