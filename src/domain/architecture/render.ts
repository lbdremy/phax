import type { ArchitectureReport } from "../../schemas/architecture.js";
import { onOneLine } from "../reportText.js";

/**
 * An architecture report as Markdown: the body as is (trailing newlines
 * stripped), then, when the report has parts, a `## Parts` section with one
 * `### name (`id`)` entry per part, in the report's order. Name and
 * description are folded onto one line; no trailing newline.
 */
export function renderArchitectureReport(report: ArchitectureReport): string {
  let out = report.body.replace(/\n+$/, "");
  if (report.parts.length === 0) return out;
  out += "\n\n## Parts";
  for (const part of report.parts) {
    out += `\n\n### ${onOneLine(part.name)} (\`${part.id}\`)\n${onOneLine(part.description)}`;
    for (const glob of part.globs) out += `\n- \`${glob}\``;
  }
  return out;
}
