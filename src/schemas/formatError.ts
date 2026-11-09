import type { ParseResult } from "effect";
import { firstRefusal, refusalsOf } from "./refusal/adapter.js";
import type { Refusal } from "./refusal/model.js";
import { refusalMessage, refusalPath } from "./refusal/render.js";

export function formatParseError(err: ParseResult.ParseError): string {
  return refusalsOf(err)
    .map((refusal) => {
      const path = refusalPath(refusal.path, "dotted");
      return `  ${path.length > 0 ? path : "(root)"}: ${refusalMessage(refusal)}`;
    })
    .join("\n");
}

// A config layer's decode failure, one refusal per line as formatParseError
// prints it, except that a gate step whose `output` is not an allowed value
// reads `gate step "<command>": output must be "log" or "gate-report"` — the
// command found in `raw` at the refusal's step path — and a missing or other
// `brief.push` reads `brief.push must be "findings" or "findings-and-rules"`.
// A refusal under `assignments` names the bound as `assignments[N]` (see
// assignmentRefusalLines).
export function formatConfigParseError(raw: unknown, err: ParseResult.ParseError): string {
  const refusals = refusalsOf(err);
  const bounds = assignmentRefusalLines(raw, refusals);
  const lines = refusals.map((refusal) => {
    const command = gateStepOutputCommand(raw, refusal.path);
    if (command !== undefined) {
      return `  gate step ${JSON.stringify(command)}: output must be "log" or "gate-report"`;
    }
    if (isBriefPush(refusal.path)) {
      return '  brief.push must be "findings" or "findings-and-rules"';
    }
    const bound = bounds.get(refusal);
    if (bound !== undefined) return `  ${bound}`;
    const path = refusalPath(refusal.path, "dotted");
    return `  ${path.length > 0 ? path : "(root)"}: ${refusalMessage(refusal)}`;
  });
  return [...new Set(lines)].join("\n");
}

// The line of every refusal under `assignments` (not `assignments` itself),
// keyed by refusal. The path's indices are bracketed (`assignments[1].kind`). An
// empty list reads `<path>: must not be empty`, not `<path>[0]: is missing`.
function assignmentRefusalLines(
  raw: unknown,
  refusals: readonly Refusal[],
): ReadonlyMap<Refusal, string> {
  const lines = new Map<Refusal, string>();
  for (const refusal of refusals) {
    if (refusal.path.length < 2 || refusal.path[0] !== "assignments") continue;
    if (isEmptyListRefusal(raw, refusal)) {
      const path = refusalPath(refusal.path.slice(0, -1), "bracketed");
      const message =
        path === "assignments"
          ? "must not be empty: omit the key to declare no bounds"
          : "must not be empty";
      lines.set(refusal, `${path}: ${message}`);
    } else {
      lines.set(refusal, `${refusalPath(refusal.path, "bracketed")}: ${refusalMessage(refusal)}`);
    }
  }
  return lines;
}

// `<list>[0]: is missing` where the list in `raw` is empty.
function isEmptyListRefusal(raw: unknown, refusal: Refusal): boolean {
  if (refusal.path.at(-1) !== 0 || refusal.kind !== "missing") return false;
  let value: unknown = raw;
  for (const segment of refusal.path.slice(0, -1)) {
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

/**
 * A violation a decoder's own check found, before any schema ran, as the line
 * `formatFirstViolation` prints for the same path and message.
 */
export function formatViolationAt(violation: {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}): string {
  const path = refusalPath(violation.path, "bracketed");
  return path.length > 0 ? `${path}: ${violation.message}` : violation.message;
}

// One refusal as `<path>: <message>` (the message alone at the root), the
// path as `acceptanceCriteria[2].refs[0]` — indices bracketed, keys dotted — so
// a violation reads as the JSON path a document author would type.
function violationLine(refusal: Refusal): string {
  const path = refusalPath(refusal.path, "bracketed");
  const message = refusalMessage(refusal);
  return path.length > 0 ? `${path}: ${message}` : message;
}

// The first violation as one line, `<path>: <message>` (the message alone when
// the violation is at the root). Used where a single rejection reason is
// printed verbatim, e.g. an authored spec or plan document.
export function formatFirstViolation(err: ParseResult.ParseError): string {
  const first = firstRefusal(err);
  return first === undefined ? err.message : violationLine(first);
}

/**
 * A refused provider answer as one line, from a decode that reported every
 * issue (`errors: "all"`). The refusals about the answer's own keys (`$schema`,
 * a key missing, a key it does not name) and about the answer itself are
 * reported together, `$schema` first and joined by `; ` (`$schema: is missing;
 * version: is unexpected, …`): a model that answered an older shape is told the
 * whole difference at once. Without one, the first violation reads as
 * `formatFirstViolation` reads it, at its full path.
 */
export function formatAnswerViolations(err: ParseResult.ParseError): string {
  const refusals = refusalsOf(err);
  const ownKeys = refusals.filter(
    ({ path, kind }) =>
      path.length === 0 ||
      (path.length === 1 && (path[0] === "$schema" || kind === "missing" || kind === "unexpected")),
  );
  if (ownKeys.length === 0) {
    return refusals[0] === undefined ? err.message : violationLine(refusals[0]);
  }
  const stamp = ownKeys.filter(({ path }) => path[0] === "$schema");
  const others = ownKeys.filter(({ path }) => path[0] !== "$schema");
  return [...stamp, ...others].map(violationLine).join("; ");
}

/**
 * The first violation of a plan document or plan sidecar as one line. A
 * violation at `phases[i].testStrategy[j]` or below names the phase and the
 * line, `<phase id> test line <j + 1> <path inside the line>: <message>`
 * (`phase-02 test line 2 loop: is missing`); the phase id is
 * `input.phases[i].id` when that is a string, `phases[i]` otherwise, and a
 * violation of the line itself has no inner path. Every other violation reads
 * as `formatFirstViolation` reads it.
 */
export function formatPlanDocumentViolation(input: unknown, err: ParseResult.ParseError): string {
  const first = firstRefusal(err);
  const [phases, i, strategy, j, ...inner] = first?.path ?? [];
  if (
    first === undefined ||
    phases !== "phases" ||
    typeof i !== "number" ||
    strategy !== "testStrategy" ||
    typeof j !== "number"
  ) {
    return formatFirstViolation(err);
  }
  const phaseId = phaseIdAt(input, i) ?? `phases[${String(i)}]`;
  const where = inner.length > 0 ? ` ${refusalPath(inner, "bracketed")}` : "";
  return `${phaseId} test line ${String(j + 1)}${where}: ${refusalMessage(first)}`;
}

function phaseIdAt(input: unknown, i: number): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const phases = (input as Record<string, unknown>)["phases"];
  if (!Array.isArray(phases)) return undefined;
  const phase: unknown = phases[i];
  if (typeof phase !== "object" || phase === null) return undefined;
  const id = (phase as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : undefined;
}
