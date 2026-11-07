import * as ParseResult from "effect/ParseResult";

/** What kind of problem a decode issue names, in the words a refusal uses. */
export function issueKind(issue: ParseResult.ParseIssue): string {
  if (issue instanceof ParseResult.Missing) return "missing";
  if (issue instanceof ParseResult.Unexpected) return "unexpected";
  if (issue instanceof ParseResult.Type) return "wrong type";
  return "invalid";
}
