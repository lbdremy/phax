/**
 * The `acceptance` lint check: a phase's `**Acceptance phase:**` and
 * `**Acceptance test files:**` lines, read from the header lines of plan.md
 * (`phaseHeader.ts`), and the old `**Oracle phase:**` and `**Oracle files:**`
 * lines, refused by name. One finding per defect, naming the line. An
 * interactive phase may sit between a pair and list its acceptance test files:
 * the close of a review that changes one re-runs the `authored` step. It still
 * takes no acceptance role.
 */
import type { LintFinding } from "./lint.js";
import { acceptanceDeclaration, declaresInteractive, type PhaseHeader } from "./phaseHeader.js";

const PASSED_BY_RE = /^passed by phase-\d{2}$/;

function error(phase: string, message: string): LintFinding {
  return { severity: "error", check: "acceptance", phase, message };
}

// The old labels, each refused once per phase wherever its lines sit.
function oldLabelDefects(header: PhaseHeader): readonly string[] {
  const defects: string[] = [];
  if (header.hasOraclePhaseLine) {
    defects.push("**Oracle phase:** is no longer read: write **Acceptance phase:**");
  }
  if (header.hasOracleFilesLine) {
    defects.push("**Oracle files:** is no longer read: write **Acceptance test files:**");
  }
  return defects;
}

// A line counts as present for pairing wherever it sits, so a misplaced line
// is reported once, as misplaced, and not again as missing.
function hasPhaseLine(header: PhaseHeader): boolean {
  return header.acceptancePhase !== null || header.misplaced.includes("Acceptance phase");
}

function hasFilesLine(header: PhaseHeader): boolean {
  return header.acceptanceFiles !== null || header.misplaced.includes("Acceptance test files");
}

function acceptanceDefects(header: PhaseHeader): readonly string[] {
  const defects: string[] = [];
  if (hasPhaseLine(header) && !hasFilesLine(header)) {
    defects.push(
      "**Acceptance phase:** without **Acceptance test files:**: write both lines or neither",
    );
  }
  if (hasFilesLine(header) && !hasPhaseLine(header)) {
    defects.push(
      "**Acceptance test files:** without **Acceptance phase:**: write both lines or neither",
    );
  }
  const value = header.acceptancePhase;
  if (value !== null && value !== "yes" && !PASSED_BY_RE.test(value)) {
    defects.push(
      `**Acceptance phase:** "${value}" is not a declaration: write "yes" or "passed by phase-NN"`,
    );
  }
  for (const label of ["Acceptance phase", "Acceptance test files"] as const) {
    if (header.misplaced.includes(label)) {
      defects.push(`**${label}:** line sits outside the header paragraph`);
    }
    if (header.repeated.includes(label)) {
      defects.push(`**${label}:** line appears more than once in the header paragraph`);
    }
  }
  return defects;
}

/** The planned-file lists of one phase, as the file-plan rules read them. */
export interface AcceptanceCheckPhase {
  readonly id: string;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
  readonly optionalFilesToEdit: readonly string[];
}

export interface AcceptanceCheckInput {
  /** The `## phase-NN` headings of plan.md, in plan order. */
  readonly headers: readonly PhaseHeader[];
  /** The parsed plan's phases, or null when lint could not parse the plan. */
  readonly phases: readonly AcceptanceCheckPhase[] | null;
  /** Whether a layer of the config declares an `acceptance` provider. */
  readonly providerConfigured: boolean;
}

interface Pair {
  readonly acceptance: string;
  readonly passing: string;
  readonly acceptanceIndex: number;
  readonly passingIndex: number;
  readonly files: readonly string[];
}

interface Declared {
  readonly header: PhaseHeader;
  /** The acceptance test files, each path once, in first-appearance order. */
  readonly files: readonly string[];
  /** The paths listed more than once, in first-appearance order. */
  readonly repeatedFiles: readonly string[];
  /** Set when the declaration names a passing phase that exists and comes after. */
  readonly pair: Pair | null;
  /** Why the declaration forms no pair; null when it does. */
  readonly pairDefect: string | null;
}

function declaredAcceptance(headers: readonly PhaseHeader[]): readonly Declared[] {
  const declared: Declared[] = [];
  headers.forEach((header, index) => {
    const declaration = acceptanceDeclaration(header);
    if (declaration === null) return;
    const { passedBy } = declaration;
    const files = [...new Set(declaration.files)];
    const repeatedFiles = files.filter(
      (file) => declaration.files.filter((f) => f === file).length > 1,
    );
    const target = passedBy.kind === "next" ? headers[index + 1]?.phase : passedBy.id;
    const targetIndex = headers.findIndex((h) => h.phase === target);
    let defect: string | null = null;
    if (target === undefined) {
      defect = `acceptance phase is passed by the next phase, and ${header.phase} is the last phase`;
    } else if (targetIndex === -1) {
      defect = `acceptance phase is passed by ${target}, which is not a phase of this plan`;
    } else if (targetIndex === index) {
      defect = `acceptance phase is passed by ${target}, which is the acceptance phase itself`;
    } else if (targetIndex < index) {
      defect = `acceptance phase is passed by ${target}, which comes before it`;
    }
    const pair: Pair | null =
      defect === null && target !== undefined
        ? {
            acceptance: header.phase,
            passing: target,
            acceptanceIndex: index,
            passingIndex: targetIndex,
            files,
          }
        : null;
    declared.push({ header, files, repeatedFiles, pair, pairDefect: defect });
  });
  return declared;
}

function passedAcceptance(pairs: readonly Pair[], phase: string): readonly string[] {
  return pairs.filter((p) => p.passing === phase).map((p) => p.acceptance);
}

function roleFindings(
  headers: readonly PhaseHeader[],
  declared: readonly Declared[],
  pairs: readonly Pair[],
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { phase } of headers) {
    const passes = passedAcceptance(pairs, phase);
    if (declared.some((d) => d.header.phase === phase) && passes.length > 0) {
      findings.push(
        error(
          phase,
          `is both an acceptance phase and the passing phase of ${passes.join(", ")}: a phase takes one acceptance role`,
        ),
      );
    }
    if (passes.length > 1) {
      findings.push(
        error(
          phase,
          `passes more than one acceptance phase (${passes.join(", ")}): one passing phase per acceptance phase`,
        ),
      );
    }
  }
  return findings;
}

// §5.12: an interactive phase takes no acceptance role, as an acceptance phase
// or as a passing one.
function interactiveRoleFindings(
  headers: readonly PhaseHeader[],
  declared: readonly Declared[],
  pairs: readonly Pair[],
): readonly LintFinding[] {
  const role: LintFinding[] = [];
  for (const header of headers) {
    if (!declaresInteractive(header)) continue;
    if (declared.some((d) => d.header.phase === header.phase)) {
      role.push(
        error(
          header.phase,
          "an interactive phase takes no acceptance role: it declares an acceptance phase",
        ),
      );
    }
    const passes = passedAcceptance(pairs, header.phase);
    if (passes.length > 0) {
      role.push(
        error(
          header.phase,
          `an interactive phase takes no acceptance role: it passes ${passes.join(", ")}`,
        ),
      );
    }
  }
  return role;
}

/**
 * Every `acceptance` error of a plan: the old-label rows (one per old label
 * per phase), the malformed-line rows, then the rule rows grouped in the order
 * of the spec's §5.6 … §5.13, each group in plan order. A path listed twice on
 * an `**Acceptance test files:**` line is one `repeated` row, right after the
 * empty-list row; the later rows read each path once. §5.11 (an interactive
 * phase inside a pair) is no rule any more: the §5.10 row skips an interactive
 * phase. The rules that read planned files report nothing when `phases` is
 * null. A phase holding only old lines declares no pair, so it gets no
 * provider row and no pairing row.
 */
export function acceptanceFindings(input: AcceptanceCheckInput): readonly LintFinding[] {
  const { headers, phases, providerConfigured } = input;
  const declared = declaredAcceptance(headers);
  const pairs = declared.flatMap((d) => (d.pair === null ? [] : [d.pair]));
  const phaseById = (id: string): AcceptanceCheckPhase | undefined =>
    phases?.find((p) => p.id === id);

  const old = headers.flatMap((h) => oldLabelDefects(h).map((m) => error(h.phase, m)));
  const malformed = headers.flatMap((h) => acceptanceDefects(h).map((m) => error(h.phase, m)));
  const passing = declared.flatMap((d) =>
    d.pairDefect === null ? [] : [error(d.header.phase, d.pairDefect)],
  );
  const noFiles = declared
    .filter((d) => d.files.length === 0)
    .map((d) =>
      error(
        d.header.phase,
        "**Acceptance test files:** lists no file: an acceptance phase lists at least one acceptance test file",
      ),
    );
  const repeated = declared.flatMap((d) =>
    d.repeatedFiles.map((file) =>
      error(
        d.header.phase,
        `acceptance test file ${file} is listed more than once on **Acceptance test files:**: list each acceptance test file once`,
      ),
    ),
  );
  const unplanned = declared.flatMap((d) => {
    const phase = phaseById(d.header.phase);
    if (phase === undefined) return [];
    const own = [...phase.plannedFilesToCreate, ...phase.plannedFilesToEdit];
    return d.files
      .filter((file) => !own.includes(file))
      .map((file) =>
        error(
          d.header.phase,
          `acceptance test file ${file} is not among this phase's planned files to create or to edit`,
        ),
      );
  });
  const between = pairs.flatMap((pair) =>
    headers.slice(pair.acceptanceIndex + 1, pair.passingIndex).flatMap((h) => {
      // A person reviewing between the pair may touch an acceptance test file.
      if (declaresInteractive(h)) return [];
      const phase = phaseById(h.phase);
      if (phase === undefined) return [];
      const listed = [
        ...phase.plannedFilesToCreate,
        ...phase.plannedFilesToEdit,
        ...phase.optionalFilesToEdit,
      ];
      return pair.files
        .filter((file) => listed.includes(file))
        .map((file) =>
          error(
            h.phase,
            `plans ${file}, an acceptance test file of ${pair.acceptance}, before ${pair.passing} passes it`,
          ),
        );
    }),
  );
  const noProvider = providerConfigured
    ? []
    : declared.map((d) =>
        error(
          d.header.phase,
          'acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)',
        ),
      );

  return [
    ...old,
    ...malformed,
    ...passing,
    ...roleFindings(headers, declared, pairs),
    ...noFiles,
    ...repeated,
    ...unplanned,
    ...between,
    ...interactiveRoleFindings(headers, declared, pairs),
    ...noProvider,
  ];
}
