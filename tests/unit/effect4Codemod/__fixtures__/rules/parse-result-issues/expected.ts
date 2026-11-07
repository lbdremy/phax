import * as SchemaIssue from "effect/SchemaIssue";

/** What kind of problem a decode issue names, in the words a refusal uses. */
export function issueKind(issue: SchemaIssue.Issue): string {
  if (issue instanceof SchemaIssue.MissingKey) return "missing";
  if (issue instanceof SchemaIssue.UnexpectedKey) return "unexpected";
  if (issue instanceof SchemaIssue.InvalidType) return "wrong type";
  return "invalid";
}
