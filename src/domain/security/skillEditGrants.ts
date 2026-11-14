import { readPlanPath } from "../plan/planPath.js";
import { matchProtected, type ProtectedList } from "./protectedPaths.js";

const SKILLS_PREFIX = ".claude/skills/";

// Characters with meaning in Claude permission-rule syntax; a path containing
// any of them cannot become an exact single-file rule.
const RULE_METACHARACTERS = /[*?[\](){}]/;

/**
 * Selects the `.claude/skills/**` files among a phase's planned paths
 * (create + edit + optional edit). Each result is an exact repo-relative POSIX
 * file path, de-duplicated, in input order. Plan paths reach the grant
 * canonical, because the decode makes them so (src/schemas/planPath.ts); a
 * non-canonical path is skipped, never rewritten, and so never granted.
 */
export function resolveSkillEditGrants(plannedPaths: readonly string[]): readonly string[] {
  const grants: string[] = [];
  const seen = new Set<string>();
  for (const raw of plannedPaths) {
    const reading = readPlanPath(raw);
    if (reading.kind !== "canonical") continue;
    const path = reading.path;
    if (!path.startsWith(SKILLS_PREFIX) || path.length === SKILLS_PREFIX.length) continue;
    if (RULE_METACHARACTERS.test(path)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    grants.push(path);
  }
  return grants;
}

export interface SkillEditConsentPhase {
  readonly id: string;
  readonly plannedFilesToCreate: readonly string[];
  readonly plannedFilesToEdit: readonly string[];
  readonly optionalFilesToEdit: readonly string[];
}

export interface SkillEditConsentGap {
  readonly phaseId: string;
  readonly files: readonly string[];
}

/** A phase's skill edit grant: its declared skill files across all three planned lists. */
export function phaseSkillEditGrants(phase: SkillEditConsentPhase): readonly string[] {
  return resolveSkillEditGrants([
    ...phase.plannedFilesToCreate,
    ...phase.plannedFilesToEdit,
    ...phase.optionalFilesToEdit,
  ]);
}

/**
 * Preflight: the phases whose declared skill files need `--allow-skill-edits`.
 * Empty when consent was given or when no phase declares a skill file.
 */
export function checkSkillEditConsent(args: {
  readonly phases: readonly SkillEditConsentPhase[];
  readonly allowSkillEdits: boolean;
}): readonly SkillEditConsentGap[] {
  if (args.allowSkillEdits) return [];
  const gaps: SkillEditConsentGap[] = [];
  for (const phase of args.phases) {
    const files = phaseSkillEditGrants(phase);
    if (files.length > 0) gaps.push({ phaseId: phase.id, files });
  }
  return gaps;
}

/** The refusal message for a missing `--allow-skill-edits` (spec §6). */
export function formatSkillEditConsentRefusal(gaps: readonly SkillEditConsentGap[]): string {
  return [
    "Security preflight failed: the plan edits skill files, which requires --allow-skill-edits.",
    ...gaps.map((gap) => `  ${gap.phaseId}: ${gap.files.join(", ")}`),
    "Re-run with --allow-skill-edits to grant exactly these files.",
  ].join("\n");
}

export interface SkillEditProtectedConflict {
  readonly phaseId: string;
  readonly file: string;
  readonly entry: string;
  readonly glob: string;
}

/**
 * The granted skill files a protected glob matches: files the plan asks to
 * edit and the operator keeps for themselves. In phase order, then grant order.
 */
export function skillEditProtectedConflicts(
  phases: readonly SkillEditConsentPhase[],
  list: ProtectedList,
): readonly SkillEditProtectedConflict[] {
  const conflicts: SkillEditProtectedConflict[] = [];
  for (const phase of phases) {
    for (const file of phaseSkillEditGrants(phase)) {
      const matched = matchProtected(list, file);
      if (matched !== undefined) {
        conflicts.push({ phaseId: phase.id, file, entry: matched.entry, glob: matched.glob });
      }
    }
  }
  return conflicts;
}

/** The refusal message for a skill edit grant on a protected path. */
export function formatSkillEditProtectedRefusal(
  conflicts: readonly SkillEditProtectedConflict[],
): string {
  return [
    "Security preflight failed: a skill edit grant names a protected path.",
    ...conflicts.map((c) => `  ${c.phaseId}: ${c.file} (${c.entry} ${c.glob})`),
    "Protected paths are the operator's decision: drop the file from the plan, or the glob from protectedPaths in phax.json.",
  ].join("\n");
}
