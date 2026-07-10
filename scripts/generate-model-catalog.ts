// Generates the model-catalog Markdown table from DEFAULT_PROVIDER_CONFIG and
// rewrites the marker-delimited region in the phax-planning skill files.
// Run with: pnpm gen:model-catalog
// Check for drift: pnpm gen:model-catalog -- --check
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PROVIDER_CONFIG } from "../src/domain/routing/defaults.js";
import type { ProviderConfig } from "../src/schemas/providerConfig.js";

export const BEGIN_MARKER = "<!-- BEGIN generated: model-catalog -->";
export const END_MARKER = "<!-- END generated: model-catalog -->";

const SKILL_FILES = [
  ".claude/skills/phax-planning/SKILL.md",
  ".agents/skills/phax-planning/SKILL.md",
];

/**
 * Render the catalog table from a ProviderConfig. Rows are grouped in the
 * order providers and families appear in the config — no sorting applied so
 * the output is stable and reproducible.
 */
export function renderCatalogTable(providerConfig: ProviderConfig): string {
  const rows: string[] = ["| ID | Family | Status | Efforts |", "| --- | --- | --- | --- |"];

  for (const providerEntry of Object.values(providerConfig.providers)) {
    const families = providerEntry.families;
    if (!families) continue;
    for (const [family, familyEntry] of Object.entries(families)) {
      for (const entry of familyEntry.models) {
        const effortsStr = entry.efforts.map((e) => `\`${e}\``).join(" \\| ");
        rows.push(`| \`${entry.id}\` | \`${family}\` | ${entry.status} | ${effortsStr} |`);
      }
    }
  }

  return rows.join("\n");
}

/**
 * Rewrite the region between BEGIN_MARKER and END_MARKER in `content` with
 * `tableContent`. Throws when either marker is absent.
 */
export function rewriteMarkerRegion(content: string, tableContent: string): string {
  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Model catalog markers not found — add ${BEGIN_MARKER} / ${END_MARKER} to the file first`,
    );
  }
  const before = content.slice(0, beginIdx + BEGIN_MARKER.length);
  const after = content.slice(endIdx);
  return `${before}\n${tableContent}\n${after}`;
}

/**
 * Returns true when the committed region between markers does not match
 * `tableContent` (i.e. the file is stale and needs regenerating).
 */
export function hasStaleRegion(content: string, tableContent: string): boolean {
  const beginIdx = content.indexOf(BEGIN_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) return true;
  const current = content.slice(beginIdx + BEGIN_MARKER.length, endIdx);
  return current !== `\n${tableContent}\n`;
}

// Anchor used when the file has not yet been migrated to the marker format.
// The generator replaces the entire block from this heading through the end of
// the "## Effort values" section with the marker-delimited catalog section.
const LEGACY_START = "## Model IDs\n";
const LEGACY_END = "\n\n## Required commands declaration";
const CATALOG_HEADING = "## Model catalog\n\n";

/**
 * Apply the catalog table to `content`. If markers already exist, delegates to
 * `rewriteMarkerRegion`. When the file still has the legacy hand-maintained
 * sections (## Model IDs / ## Effort values), replaces those with the
 * marker-delimited catalog block. Throws when neither the markers nor the
 * legacy anchor are found.
 */
export function applyToContent(content: string, tableContent: string): string {
  if (content.includes(BEGIN_MARKER)) {
    return rewriteMarkerRegion(content, tableContent);
  }
  const startIdx = content.indexOf(LEGACY_START);
  const endIdx = content.indexOf(LEGACY_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Cannot locate model catalog section in file — add ${BEGIN_MARKER} / ${END_MARKER} markers or restore the legacy ## Model IDs heading`,
    );
  }
  const markerBlock = `${CATALOG_HEADING}${BEGIN_MARKER}\n${tableContent}\n${END_MARKER}`;
  return content.slice(0, startIdx) + markerBlock + content.slice(endIdx);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const checkMode = process.argv.includes("--check");
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const tableContent = renderCatalogTable(DEFAULT_PROVIDER_CONFIG);

  let stale = false;
  for (const relPath of SKILL_FILES) {
    const filePath = join(repoRoot, relPath);
    const content = readFileSync(filePath, "utf8");

    if (checkMode) {
      if (hasStaleRegion(content, tableContent)) {
        console.error(`Stale model catalog in ${relPath} — run: pnpm gen:model-catalog`);
        stale = true;
      }
    } else {
      const updated = applyToContent(content, tableContent);
      if (updated !== content) {
        writeFileSync(filePath, updated, "utf8");
        console.log(`Updated: ${relPath}`);
      } else {
        console.log(`Already up to date: ${relPath}`);
      }
    }
  }

  if (stale) process.exit(1);
}
