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
// command found in `raw` at the issue's step path — a missing or other
// `brief.push` reads `brief.push must be "findings" or "findings-and-rules"`,
// once, without the `brief: Expected undefined` alternative of the optional
// `brief` key beside it. A refusal under `assignments` names the bound as
// `assignments[N]` (see assignmentIssueLines).
export function formatConfigParseError(raw: unknown, err: ParseResult.ParseError): string {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(err);
  const pushRefused = issues.some(({ path }) => isBriefPush(path));
  const bounds = assignmentIssueLines(raw, issues);
  const lines = issues
    .filter(({ path }) => !(pushRefused && path.length === 1 && path[0] === "brief"))
    .filter(({ path }) => !(bounds.size > 0 && path.length === 1 && path[0] === "assignments"))
    .map((issue) => {
      const command = gateStepOutputCommand(raw, issue.path);
      if (command !== undefined) {
        return `  gate step ${JSON.stringify(command)}: output must be "log" or "gate-report"`;
      }
      if (isBriefPush(issue.path)) {
        return '  brief.push must be "findings" or "findings-and-rules"';
      }
      const bound = bounds.get(issue);
      if (bound !== undefined) return `  ${bound}`;
      const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `  ${path}: ${issue.message}`;
    });
  return [...new Set(lines)].join("\n");
}

type ConfigIssue = ParseResult.ArrayFormatterIssue;

const LITERAL_MISMATCH_RE = /^Expected (.+), actual (.+)$/;

// The line of every issue under `assignments` (not `assignments` itself),
// keyed by issue. The path's indices are bracketed (`assignments[1].kind`). An
// empty list reads `<path>: must not be empty`, not `<path>[0]: is missing`.
// The issues of one literal union at one path (an effort outside the
// vocabulary) merge into one `Expected "a" | "b", actual "x"` line. While any
// of these issues stands, the `assignments: Expected undefined` alternative of
// the optional key is dropped.
function assignmentIssueLines(
  raw: unknown,
  issues: readonly ConfigIssue[],
): ReadonlyMap<ConfigIssue, string> {
  const byPath = new Map<string, ConfigIssue[]>();
  for (const issue of issues) {
    if (issue.path.length < 2 || issue.path[0] !== "assignments") continue;
    const empty = isEmptyListIssue(raw, issue);
    const path = formatIssuePath(empty ? issue.path.slice(0, -1) : issue.path);
    byPath.set(path, [...(byPath.get(path) ?? []), issue]);
  }
  const lines = new Map<ConfigIssue, string>();
  for (const [path, group] of byPath) {
    const [first] = group as [ConfigIssue, ...ConfigIssue[]];
    let message = first.message;
    if (isEmptyListIssue(raw, first)) {
      message =
        path === "assignments"
          ? "must not be empty: omit the key to declare no bounds"
          : "must not be empty";
    } else {
      const mismatches = group.map((i) => i.message.match(LITERAL_MISMATCH_RE));
      const actual = mismatches[0]?.[2];
      if (group.length > 1 && mismatches.every((m) => m !== null && m[2] === actual)) {
        message = `Expected ${mismatches.map((m) => m![1]).join(" | ")}, actual ${actual}`;
      }
    }
    for (const issue of group) lines.set(issue, `${path}: ${message}`);
  }
  return lines;
}

// `<list>[0]: is missing` where the list in `raw` is empty.
function isEmptyListIssue(raw: unknown, issue: ConfigIssue): boolean {
  if (issue.path.at(-1) !== 0 || issue.message !== "is missing") return false;
  let value: unknown = raw;
  for (const segment of issue.path.slice(0, -1)) {
    if (typeof value !== "object" || value === null) return false;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return Array.isArray(value) && value.length === 0;
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
