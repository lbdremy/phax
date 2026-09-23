import { ParseResult } from "effect";

export function formatParseError(err: ParseResult.ParseError): string {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(err);
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    })
    .join("\n");
}

// `acceptanceCriteria[2].refs[0]` — array indices bracketed, keys dotted — so a
// violation reads as the JSON path a document author would type.
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  return path
    .map((segment, i) =>
      typeof segment === "number" ? `[${segment}]` : `${i === 0 ? "" : "."}${String(segment)}`,
    )
    .join("");
}

// The first violation as one line, `<path>: <message>` (the message alone when
// the violation is at the root). Used where a single rejection reason is
// printed verbatim, e.g. an authored spec or plan document.
export function formatFirstViolation(err: ParseResult.ParseError): string {
  const [first] = ParseResult.ArrayFormatter.formatErrorSync(err);
  if (first === undefined) return err.message;
  const path = formatIssuePath(first.path);
  return path.length > 0 ? `${path}: ${first.message}` : first.message;
}
