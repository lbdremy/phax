// Re-renders a headless-authored spec's Markdown body from its JSON sidecar,
// keeping the frontmatter as is. For applying hand edits made to the sidecar
// (e.g. §9 answers) until `phax artifact decide` exists.
// Run with: pnpm exec tsx scripts/rerender-spec.ts docs/specs/<name>.md [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { Either } from "effect";
import { formatFirstViolation } from "../src/schemas/formatError.js";
import { decodeSpecDocumentFile } from "../src/schemas/specDocument.js";
import { renderSpecBody } from "../src/domain/authoring/renderSpec.js";
import { splitFrontmatter } from "../src/domain/artifact/frontmatter.js";
import { sidecarPathFor } from "../src/domain/artifact/sidecar.js";

const [mdPath, flag] = process.argv.slice(2);
if (mdPath === undefined) {
  console.error("usage: tsx scripts/rerender-spec.ts <spec.md> [--check]");
  process.exit(2);
}

const md = readFileSync(mdPath, "utf8");
const split = splitFrontmatter(md);
if (split === null) {
  console.error(`${mdPath}: no frontmatter block`);
  process.exit(1);
}

// The sidecar as phax persists it: `$schema` first, then the document.
const decoded = decodeSpecDocumentFile(JSON.parse(readFileSync(sidecarPathFor(mdPath), "utf8")));
if (Either.isLeft(decoded)) {
  console.error(`${sidecarPathFor(mdPath)}: ${formatFirstViolation(decoded.left)}`);
  process.exit(1);
}

const next = `---\n${split.yamlText}\n---\n${renderSpecBody(decoded.right)}`;
if (flag === "--check") {
  console.log(next === md ? "unchanged" : "would change");
  process.exit(next === md ? 0 : 1);
}
writeFileSync(mdPath, next);
console.log(next === md ? `${mdPath}: unchanged` : `${mdPath}: re-rendered`);
