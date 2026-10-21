/**
 * The `oracles` lint check: a phase's `**Oracle phase:**` and
 * `**Oracle files:**` lines, read from the header lines of plan.md
 * (`phaseHeader.ts`). One finding per defect, naming the line.
 */
import type { LintFinding } from "./lint.js";
import { declaresInteractive, oracleDeclaration, type PhaseHeader } from "./phaseHeader.js";

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
 * One error per phase with a well-formed oracle declaration. Stays until the
 * oracle step can run; the gate-loop phase deletes it.
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

/** The planned-file lists of one phase, as the file-plan rules read them. */
export interface OracleCheckPhase {
  readonly id: string;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
  readonly optionalFilesToEdit: readonly string[];
}

export interface OracleCheckInput {
  /** The `## phase-NN` headings of plan.md, in plan order. */
  readonly headers: readonly PhaseHeader[];
  /** The parsed plan's phases, or null when lint could not parse the plan. */
  readonly phases: readonly OracleCheckPhase[] | null;
  /** Whether a layer of the config declares an `oracles` provider. */
  readonly providerConfigured: boolean;
}

interface Pair {
  readonly oracle: string;
  readonly discharging: string;
  readonly oracleIndex: number;
  readonly dischargingIndex: number;
  readonly files: readonly string[];
}

interface Declared {
  readonly header: PhaseHeader;
  readonly files: readonly string[];
  /** Set when the declaration names a discharging phase that exists and comes after. */
  readonly pair: Pair | null;
  /** Why the declaration forms no pair; null when it does. */
  readonly pairDefect: string | null;
}

function declaredOracles(headers: readonly PhaseHeader[]): readonly Declared[] {
  const declared: Declared[] = [];
  headers.forEach((header, index) => {
    const declaration = oracleDeclaration(header);
    if (declaration === null) return;
    const { dischargedBy, files } = declaration;
    const target = dischargedBy.kind === "next" ? headers[index + 1]?.phase : dischargedBy.id;
    const targetIndex = headers.findIndex((h) => h.phase === target);
    let defect: string | null = null;
    if (target === undefined) {
      defect = `oracle phase is discharged by the next phase, and ${header.phase} is the last phase`;
    } else if (targetIndex === -1) {
      defect = `oracle phase is discharged by ${target}, which is not a phase of this plan`;
    } else if (targetIndex === index) {
      defect = `oracle phase is discharged by ${target}, which is the oracle phase itself`;
    } else if (targetIndex < index) {
      defect = `oracle phase is discharged by ${target}, which comes before it`;
    }
    const pair: Pair | null =
      defect === null && target !== undefined
        ? {
            oracle: header.phase,
            discharging: target,
            oracleIndex: index,
            dischargingIndex: targetIndex,
            files,
          }
        : null;
    declared.push({ header, files, pair, pairDefect: defect });
  });
  return declared;
}

function dischargedOracles(pairs: readonly Pair[], phase: string): readonly string[] {
  return pairs.filter((p) => p.discharging === phase).map((p) => p.oracle);
}

function roleFindings(
  headers: readonly PhaseHeader[],
  declared: readonly Declared[],
  pairs: readonly Pair[],
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  for (const { phase } of headers) {
    const discharges = dischargedOracles(pairs, phase);
    if (declared.some((d) => d.header.phase === phase) && discharges.length > 0) {
      findings.push(
        error(
          phase,
          `is both an oracle phase and the discharging phase of ${discharges.join(", ")}: a phase takes one oracle role`,
        ),
      );
    }
    if (discharges.length > 1) {
      findings.push(
        error(
          phase,
          `discharges more than one oracle phase (${discharges.join(", ")}): one discharging phase per oracle phase`,
        ),
      );
    }
  }
  return findings;
}

function interactiveRows(
  headers: readonly PhaseHeader[],
  declared: readonly Declared[],
  pairs: readonly Pair[],
): { readonly inside: readonly LintFinding[]; readonly role: readonly LintFinding[] } {
  const inside: LintFinding[] = [];
  const role: LintFinding[] = [];
  headers.forEach((header, index) => {
    if (!declaresInteractive(header)) return;
    for (const pair of pairs) {
      if (index > pair.oracleIndex && index < pair.dischargingIndex) {
        inside.push(
          error(
            header.phase,
            `interactive phase sits between oracle ${pair.oracle} and its discharging phase ${pair.discharging}`,
          ),
        );
      }
    }
    if (declared.some((d) => d.header.phase === header.phase)) {
      role.push(
        error(
          header.phase,
          "an interactive phase takes no oracle role: it declares an oracle phase",
        ),
      );
    }
    const discharges = dischargedOracles(pairs, header.phase);
    if (discharges.length > 0) {
      role.push(
        error(
          header.phase,
          `an interactive phase takes no oracle role: it discharges ${discharges.join(", ")}`,
        ),
      );
    }
  });
  return { inside, role };
}

/**
 * Every `oracles` error of a plan: the malformed-line rows, then the rule rows
 * grouped in the order of the spec's §5.6 … §5.13, each group in plan order,
 * then the not-supported refusal. The rules that read planned files report
 * nothing when `phases` is null.
 */
export function oracleFindings(input: OracleCheckInput): readonly LintFinding[] {
  const { headers, phases, providerConfigured } = input;
  const declared = declaredOracles(headers);
  const pairs = declared.flatMap((d) => (d.pair === null ? [] : [d.pair]));
  const phaseById = (id: string): OracleCheckPhase | undefined => phases?.find((p) => p.id === id);

  const malformed = headers.flatMap((h) => oracleDefects(h).map((m) => error(h.phase, m)));
  const discharging = declared.flatMap((d) =>
    d.pairDefect === null ? [] : [error(d.header.phase, d.pairDefect)],
  );
  const noFiles = declared
    .filter((d) => d.files.length === 0)
    .map((d) =>
      error(
        d.header.phase,
        "**Oracle files:** lists no file: an oracle phase lists at least one oracle file",
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
          `oracle file ${file} is not among this phase's planned files to create or to edit`,
        ),
      );
  });
  const between = pairs.flatMap((pair) =>
    headers.slice(pair.oracleIndex + 1, pair.dischargingIndex).flatMap((h) => {
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
            `plans ${file}, an oracle file of ${pair.oracle}, before ${pair.discharging} discharges it`,
          ),
        );
    }),
  );
  const interactive = interactiveRows(headers, declared, pairs);
  const noProvider = providerConfigured
    ? []
    : declared.map((d) =>
        error(
          d.header.phase,
          'oracle phase declared, but no "oracles" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)',
        ),
      );

  return [
    ...malformed,
    ...discharging,
    ...roleFindings(headers, declared, pairs),
    ...noFiles,
    ...unplanned,
    ...between,
    ...interactive.inside,
    ...interactive.role,
    ...noProvider,
    ...unsupportedOracleFindings(headers),
  ];
}
