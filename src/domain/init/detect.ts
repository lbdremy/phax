import type { PackageJson } from "../../schemas/packageJson.js";

export function slugify(raw: string): string {
  const stripped = raw.replace(/^@[^/]+\//, "");
  let slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (/^[0-9]/.test(slug)) {
    slug = "p-" + slug;
  }

  return slug;
}

export function detectName(pkg: PackageJson, cwdBasename: string): string {
  if (pkg.name) {
    const s = slugify(pkg.name);
    if (s) return s;
  }
  const s = slugify(cwdBasename);
  if (s) return s;
  return "project";
}

export function detectPackageManager(pkg: PackageJson): "pnpm" | "npm" | "yarn" {
  const pm = pkg.packageManager;
  if (!pm) return "pnpm";
  if (pm.startsWith("pnpm")) return "pnpm";
  if (pm.startsWith("yarn")) return "yarn";
  if (pm.startsWith("npm")) return "npm";
  return "pnpm";
}

export type GateCommandSuggestion = {
  readonly script: string;
  readonly command: string;
  readonly recommended: boolean;
};

const ORDERED_SCRIPTS = [
  "typecheck",
  "lint",
  "test:unit",
  "test",
  "format",
  "format:check",
  "build",
] as const;

const RECOMMENDED_SCRIPTS = new Set<string>(["typecheck", "lint", "test:unit", "test"]);

export function suggestGateCommands(
  pkg: PackageJson,
  pm: "pnpm" | "npm" | "yarn",
): ReadonlyArray<GateCommandSuggestion> {
  const scripts = pkg.scripts ?? {};
  const hasTestUnit = Object.prototype.hasOwnProperty.call(scripts, "test:unit");
  const results: GateCommandSuggestion[] = [];

  for (const script of ORDERED_SCRIPTS) {
    if (!Object.prototype.hasOwnProperty.call(scripts, script)) continue;
    let recommended = RECOMMENDED_SCRIPTS.has(script);
    if (script === "test" && hasTestUnit) recommended = false;
    results.push({ script, command: `${pm} ${script}`, recommended });
  }

  return results;
}
