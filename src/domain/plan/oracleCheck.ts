/**
 * The `oracles` lint check: a phase's `**Oracle phase:**` and
 * `**Oracle files:**` lines, read from the header lines of plan.md
 * (`phaseHeader.ts`). One finding per defect, naming the line.
 */
import type { LintFinding } from "./lint.js";
import { oracleDeclaration, type PhaseHeader } from "./phaseHeader.js";

const DISCHARGED_BY_RE = /^discharged by phase-\d{2}$/;

function error(phase: string, message: string): LintFinding {
  return { severity: "error", check: "oracles", phase, message };
}

// A line counts as present for pairing wherever it sits, so a misplaced line
// is reported once, as misplaced, and not again as missing.
function hasPhaseLine(header: PhaseHeader): boolean {
  return header.oraclePhase !== null || header.misplaced.includes("Oracle phase");
}

function hasFilesLine(header: PhaseHeader): boolean {
  return header.oracleFiles !== null || header.misplaced.includes("Oracle files");
}

function oracleDefects(header: PhaseHeader): readonly string[] {
  const defects: string[] = [];
  if (hasPhaseLine(header) && !hasFilesLine(header)) {
    defects.push("**Oracle phase:** without **Oracle files:**: write both lines or neither");
  }
  if (hasFilesLine(header) && !hasPhaseLine(header)) {
    defects.push("**Oracle files:** without **Oracle phase:**: write both lines or neither");
  }
  const value = header.oraclePhase;
  if (value !== null && value !== "yes" && !DISCHARGED_BY_RE.test(value)) {
    defects.push(
      `**Oracle phase:** "${value}" is not a declaration: write "yes" or "discharged by phase-NN"`,
    );
  }
  for (const label of ["Oracle phase", "Oracle files"] as const) {
    if (header.misplaced.includes(label)) {
      defects.push(`**${label}:** line sits outside the header paragraph`);
    }
    if (header.repeated.includes(label)) {
      defects.push(`**${label}:** line appears more than once in the header paragraph`);
    }
  }
  return defects;
}

/**
 * One error per phase with a well-formed oracle declaration. The oracle-phases
 * runtime plan replaces this with its §5.6–§5.13 rules.
 */
export function unsupportedOracleFindings(headers: readonly PhaseHeader[]): readonly LintFinding[] {
  return headers
    .filter((h) => oracleDeclaration(h) !== null)
    .map((h) =>
      error(
        h.phase,
        "declared an oracle phase (**Oracle phase:**): this phax cannot run an oracle phase yet; remove the oracle lines",
      ),
    );
}

/** Every `oracles` error: malformed oracle lines, then the not-supported refusal. */
export function oracleFindings(headers: readonly PhaseHeader[]): readonly LintFinding[] {
  return headers.flatMap((h) => [
    ...oracleDefects(h).map((message) => error(h.phase, message)),
    ...unsupportedOracleFindings([h]),
  ]);
}
