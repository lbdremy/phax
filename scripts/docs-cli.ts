// Regenerates docs/cli/reference.md and updates the README CLI summary section.
// Run with: pnpm docs:cli
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const README_BEGIN = "<!-- BEGIN GENERATED CLI REFERENCE -->";
export const README_END = "<!-- END GENERATED CLI REFERENCE -->";

export function buildCliSummary(referenceMarkdown: string): string {
  const lines = referenceMarkdown.split("\n");
  const rows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("## `phax ")) continue;

    let usage = "";
    let desc = "";

    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      if (lines[j].startsWith("## ")) break;
      if (usage === "") {
        const m = /^- \*\*Usage\*\*: `(.+)`$/.exec(lines[j]);
        if (m) {
          usage = m[1];
          continue;
        }
      } else if (
        lines[j].trim() &&
        !lines[j].startsWith("-") &&
        !lines[j].startsWith("|") &&
        !lines[j].startsWith("#")
      ) {
        desc = lines[j].trim();
        break;
      }
    }

    if (usage) rows.push(`- \`${usage}\` — ${desc}`);
  }

  return [
    "Full CLI reference: [`docs/cli/reference.md`](docs/cli/reference.md).",
    "",
    ...rows,
  ].join("\n");
}

export function injectReadmeSection(readme: string, content: string): string {
  const beginIdx = readme.indexOf(README_BEGIN);
  const endIdx = readme.indexOf(README_END);

  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(`README.md is missing marker comments:\n  ${README_BEGIN}\n  ${README_END}`);
  }

  return (
    readme.slice(0, beginIdx + README_BEGIN.length) +
    "\n\n" +
    content +
    "\n\n" +
    readme.slice(endIdx)
  );
}

function main(): void {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const specPath = join(repoRoot, "phax.usage.kdl");
  const refPath = join(repoRoot, "docs/cli/reference.md");
  const readmePath = join(repoRoot, "README.md");

  execFileSync("usage", ["generate", "markdown", "-f", specPath, "--out-file", refPath], {
    stdio: "inherit",
  });
  console.log(`Written: ${refPath}`);

  const refContent = readFileSync(refPath, "utf8");
  const summary = buildCliSummary(refContent);

  const readme = readFileSync(readmePath, "utf8");
  const updated = injectReadmeSection(readme, summary);
  writeFileSync(readmePath, updated, "utf8");
  console.log(`Updated: ${readmePath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
