import { collectPlanStructureErrors } from "./parsePlanMarkdown.js";
import { checkRequiredCommands } from "../security/agentCommands.js";
import { preflightPhaseModels, type PreflightPhase } from "../routing/preflight.js";
import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";
import type { PlanAuditResponse } from "../../schemas/planAudit.js";

export type LintSeverity = "error" | "warning";
export type LintCheck = "structure" | "files" | "commands" | "models" | "advisory";

export interface LintFinding {
  readonly severity: LintSeverity;
  readonly check: LintCheck;
  readonly phase: string | null;
  readonly message: string;
}

/**
 * Maps every structural defect `collectPlanStructureErrors` can find to an
 * `error` finding on the `structure` check (spec 33 §5.2, §6).
 */
export function structureFindings(planMd: string): readonly LintFinding[] {
  return collectPlanStructureErrors(planMd).map((e) => ({
    severity: "error",
    check: "structure",
    phase: e.phase,
    message: e.message,
  }));
}

/**
 * A repo-tracked plan mirrors its source spec's slug (spec
 * artifact-timestamp-naming §5.3). A plan with no source spec, or a source
 * spec whose name does not parse, has nothing to compare against.
 */
export function lineageFindings(
  planSlug: string,
  sourceSpecSlug: string | null,
): readonly LintFinding[] {
  if (sourceSpecSlug === null || planSlug === sourceSpecSlug) return [];
  return [
    {
      severity: "error",
      check: "structure",
      phase: null,
      message: `slug "${planSlug}" differs from source spec slug "${sourceSpecSlug}"`,
    },
  ];
}

export interface FilePlanPhase {
  readonly id: string;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
  readonly optionalFilesToEdit: readonly string[];
}

/**
 * The deduplicated union of every phase's create/edit paths, in plan order.
 * The app layer probes exactly these paths against the working tree.
 */
export function plannedPaths(phases: ReadonlyArray<FilePlanPhase>): readonly string[] {
  const paths = new Set<string>();
  for (const phase of phases) {
    for (const path of phase.plannedFilesToCreate) paths.add(path);
    for (const path of phase.plannedFilesToEdit) paths.add(path);
  }
  return [...paths];
}

/**
 * Walks the phases in order over a `known` map seeded from `existing`,
 * flagging edits of unreachable files, creates of existing or
 * already-created files, and a phase that both creates and edits a path
 * (spec 33 §5.4-§5.7). Optional files are never checked on their own.
 */
export function filePlanFindings(
  phases: ReadonlyArray<FilePlanPhase>,
  existing: ReadonlySet<string>,
): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const known = new Map<string, "ground" | string>();
  for (const path of existing) known.set(path, "ground");

  for (const phase of phases) {
    const createdHere = new Set<string>();

    for (const path of phase.plannedFilesToCreate) {
      // A create/edit collision is its own defect (spec 33 §5.6); it does not
      // excuse the path from §5.5, so the checks below still run on it.
      if (phase.plannedFilesToEdit.includes(path)) {
        findings.push({
          severity: "error",
          check: "files",
          phase: phase.id,
          message: `create and edit both list ${path}`,
        });
      }

      const origin = known.get(path);
      if (origin === "ground") {
        findings.push({
          severity: "error",
          check: "files",
          phase: phase.id,
          message: `create ${path}: exists in the working tree`,
        });
      } else if (origin !== undefined) {
        findings.push({
          severity: "error",
          check: "files",
          phase: phase.id,
          message: `create ${path}: already created by ${origin}`,
        });
      }

      if (phase.optionalFilesToEdit.includes(path)) {
        findings.push({
          severity: "warning",
          check: "files",
          phase: phase.id,
          message: `create ${path}: also listed under optional files`,
        });
      }

      createdHere.add(path);
    }

    for (const path of phase.plannedFilesToEdit) {
      if (createdHere.has(path)) continue;
      if (!known.has(path)) {
        findings.push({
          severity: "error",
          check: "files",
          phase: phase.id,
          message: `edit ${path}: does not exist and no earlier phase creates it`,
        });
      }
    }

    for (const path of createdHere) known.set(path, phase.id);
  }

  return findings;
}

/**
 * The run-start required-commands preflight, reported as findings (spec 33
 * §5.8). Same inputs `executePlan` gives `checkRequiredCommands`, so a command
 * the run would refuse is a lint error for the same reason.
 */
export function commandFindings(
  requiredCommands: readonly string[],
  configCommands: readonly string[],
  gateCommands: readonly string[],
): readonly LintFinding[] {
  const { missing } = checkRequiredCommands({ requiredCommands, configCommands, gateCommands });
  return missing.map((command) => ({
    severity: "error",
    check: "commands",
    phase: null,
    message: `required command "${command}" is not covered by security.agentCommands or the gate profile`,
  }));
}

/**
 * The run-start model preflight, reported as findings (spec 33 §5.9). The
 * catalog-derived alternatives ride along in the message so a rejected plan
 * can be corrected without running it.
 */
export function modelFindings(
  phases: readonly PreflightPhase[],
  routing: ModelRouting,
  providerConfig: ProviderConfig,
): readonly LintFinding[] {
  const { failures } = preflightPhaseModels(phases, routing, providerConfig);
  return failures.map((failure) => {
    const alternatives =
      failure.alternatives.length > 0
        ? ` (alternatives: ${failure.alternatives.map((a) => a.id).join(", ")})`
        : "";
    return {
      severity: "error",
      check: "models",
      phase: failure.phaseId,
      message: `${failure.model} / ${failure.effort}: ${failure.reasons.join("; ")}${alternatives}`,
    };
  });
}

// Everything an auditor returns is untrusted text rendered straight into the
// terminal report. Drop ANSI sequences and control characters so a finding
// cannot repaint or reflow the report, and bound each field so one finding
// cannot swamp it. The phase bound is generous next to a real `phase-NN` id;
// it exists only to stop an absurd string from raggeding the phase column.
// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\u001B\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]+/g;
const ADVISORY_MESSAGE_LIMIT = 500;
const ADVISORY_PHASE_LIMIT = 32;

function sanitizeProviderText(text: string, limit: number): string {
  const flattened = text.replace(ANSI_SEQUENCE, "").replace(CONTROL_CHARS, " ").trim();
  return flattened.length > limit ? `${flattened.slice(0, limit)}…` : flattened;
}

/**
 * Fans an auditor response out to one `advisory` warning per phase a finding
 * names, in order; a finding naming no phase becomes a single `phase: null`
 * warning. Severity is always `warning` — findings never affect the exit code.
 * A phase that sanitizes down to nothing is reported as unnamed rather than as
 * a blank column.
 */
export function advisoryFindings(response: PlanAuditResponse): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  for (const finding of response.findings) {
    const sanitized = sanitizeProviderText(finding.message, ADVISORY_MESSAGE_LIMIT);
    // `NonEmptyString` still admits a message that is nothing but control
    // characters; a placeholder keeps the row meaningful.
    const message = sanitized.length > 0 ? sanitized : "(auditor returned an empty message)";
    if (finding.phases.length === 0) {
      findings.push({ severity: "warning", check: "advisory", phase: null, message });
      continue;
    }
    for (const phase of finding.phases) {
      const sanitizedPhase = sanitizeProviderText(phase, ADVISORY_PHASE_LIMIT);
      findings.push({
        severity: "warning",
        check: "advisory",
        phase: sanitizedPhase.length > 0 ? sanitizedPhase : null,
        message,
      });
    }
  }
  return findings;
}

// A failing auditor is most often a broken script, and the first line of a
// crashing runtime's stderr is boilerplate — Node opens with its own loader
// frame and only names the cause several lines down. Condense every non-empty
// line onto one row instead, bounded so the report stays readable.
const STDERR_MESSAGE_LIMIT = 300;

function condenseStderr(stderr: string): string | undefined {
  const lines = stderr
    .split("\n")
    .map((line) => sanitizeProviderText(line, STDERR_MESSAGE_LIMIT))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  const joined = lines.join(" | ");
  return joined.length > STDERR_MESSAGE_LIMIT
    ? `${joined.slice(0, STDERR_MESSAGE_LIMIT)}…`
    : joined;
}

/**
 * Maps a failed auditor invocation to a single `advisory` warning, never an
 * effect error — the lint must not depend on the auditor being reachable.
 */
export function auditorFailureFinding(failure: {
  readonly message: string;
  readonly stderrExcerpt?: string;
}): LintFinding {
  const stderr =
    failure.stderrExcerpt !== undefined ? condenseStderr(failure.stderrExcerpt) : undefined;
  const message =
    stderr !== undefined
      ? `plan auditor failed: ${failure.message}; stderr: ${stderr}`
      : `plan auditor failed: ${failure.message}`;
  return { severity: "warning", check: "advisory", phase: null, message };
}

/** True when at least one finding has severity `error` — the CLI's exit code. */
export function hasLintErrors(findings: readonly LintFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
