const SKILLS_PREFIX = ".claude/skills/";

// Characters with meaning in Claude permission-rule syntax; a path containing
// any of them cannot become an exact single-file rule.
const RULE_METACHARACTERS = /[*?[\](){}]/;

/**
 * Normalises a repo-relative path to POSIX form: drops a leading `./`, empty
 * and `.` segments. Returns `undefined` for absolute paths or any `..` segment.
 */
function normaliseRepoRelative(raw: string): string | undefined {
  if (raw.startsWith("/")) return undefined;
  const segments = raw.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) return undefined;
  return segments.join("/");
}

/**
 * Selects the `.claude/skills/**` files among a phase's planned paths
 * (create + edit + optional edit). Each result is an exact repo-relative POSIX
 * file path: normalised, de-duplicated, in input order.
 */
export function resolveSkillEditGrants(plannedPaths: readonly string[]): readonly string[] {
  const grants: string[] = [];
  const seen = new Set<string>();
  for (const raw of plannedPaths) {
    const path = normaliseRepoRelative(raw);
    if (path === undefined) continue;
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
