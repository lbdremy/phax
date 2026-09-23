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
