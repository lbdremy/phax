// The hello-world rules, shared by the gate step (audit.mjs) and the brief
// provider (brief.mjs) so both name the same rules, ids and guides.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NODE_IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']node:([^"']+)["']/;
const EXPORTED_FUNCTION_RE =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\b|^\s*export\s+const\s+\w+\s*=\s*(?:async\s*)?(?:\(|\w+\s*=>|function\b)/;

export const NO_NODE_IMPORT = {
  rule: "a module under src/ imports no node: module",
  guide: { summary: "keep I/O in the module's caller", read: "guides/no-node-import.md" },
};

export const EXPORTS_FUNCTION = {
  rule: "a module under src/ exports its function",
  guide: null,
};

/**
 * The findings for the given repo-relative `.ts` paths under src/, in the
 * order given, skipping files that do not exist: one per imported node:
 * module, at its first import, then one when the file exports no function.
 */
export function findingsFor(cwd, files) {
  const findings = [];
  for (const file of files) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    const seen = new Set();
    lines.forEach((line, index) => {
      const module = NODE_IMPORT_RE.exec(line)?.[1];
      if (module === undefined || seen.has(module)) return;
      seen.add(module);
      findings.push({
        id: `no-node-import ${file} node:${module}`,
        rule: NO_NODE_IMPORT.rule,
        location: { file, lines: [index + 1, index + 1] },
        message: `imports node:${module}`,
        related: [],
        guide: NO_NODE_IMPORT.guide,
      });
    });
    if (!lines.some((line) => EXPORTED_FUNCTION_RE.test(line))) {
      findings.push({
        id: `exports-function ${file}`,
        rule: EXPORTS_FUNCTION.rule,
        location: { file, lines: null },
        message: "no exported function",
        related: [],
        guide: EXPORTS_FUNCTION.guide,
      });
    }
  }
  return findings;
}
