import { ParseResult } from "effect"

export function formatParseError(err: ParseResult.ParseError): string {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(err)
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"
      return `  ${path}: ${issue.message}`
    })
    .join("\n")
}
