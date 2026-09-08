import { collectPlanStructureErrors } from "./parsePlanMarkdown.js";
import { checkRequiredCommands } from "../security/agentCommands.js";
import { preflightPhaseModels, type PreflightPhase } from "../routing/preflight.js";
import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderConfig } from "../../schemas/providerConfig.js";

export type LintSeverity = "error" | "warning";
export type LintCheck = "structure" | "files" | "commands" | "models";

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

/** True when at least one finding has severity `error` — the CLI's exit code. */
export function hasLintErrors(findings: readonly LintFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
