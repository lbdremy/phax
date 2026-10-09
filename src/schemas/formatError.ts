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

// A config layer's decode failure, one issue per line as formatParseError
// prints it, except that a gate step whose `output` is not an allowed value
// reads `gate step "<command>": output must be "log" or "gate-report"` — the
// command found in `raw` at the issue's step path — and a missing or other
// `brief.push` reads `brief.push must be "findings" or "findings-and-rules"`,
// once, without the `brief: Expected undefined` alternative of the optional
// `brief` key beside it.
export function formatConfigParseError(raw: unknown, err: ParseResult.ParseError): string {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(err);
  const pushRefused = issues.some(({ path }) => isBriefPush(path));
  const lines = issues
    .filter(({ path }) => !(pushRefused && path.length === 1 && path[0] === "brief"))
    .map((issue) => {
      const command = gateStepOutputCommand(raw, issue.path);
      if (command !== undefined) {
        return `  gate step ${JSON.stringify(command)}: output must be "log" or "gate-report"`;
      }
      if (isBriefPush(issue.path)) {
        return '  brief.push must be "findings" or "findings-and-rules"';
      }
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    });
  return [...new Set(lines)].join("\n");
}

function isBriefPush(path: ReadonlyArray<PropertyKey>): boolean {
  return path.length === 2 && path[0] === "brief" && path[1] === "push";
}

// The step's command when `path` is `…gateProfiles.<profile>.<index>.output`.
function gateStepOutputCommand(raw: unknown, path: ReadonlyArray<PropertyKey>): string | undefined {
  if (path.length < 4 || path.at(-1) !== "output" || path.at(-4) !== "gateProfiles") {
    return undefined;
  }
  let step: unknown = raw;
  for (const segment of path.slice(0, -1)) {
    if (typeof step !== "object" || step === null) return undefined;
    step = (step as Record<PropertyKey, unknown>)[segment];
  }
  if (typeof step !== "object" || step === null) return undefined;
  const command = (step as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : undefined;
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
