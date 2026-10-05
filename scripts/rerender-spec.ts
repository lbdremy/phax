// Re-renders a headless-authored spec's Markdown body from its JSON sidecar,
// keeping the frontmatter as is. For applying hand edits made to the sidecar
// (e.g. §9 answers) until `phax artifact decide` exists.
// Run with: pnpm exec tsx scripts/rerender-spec.ts docs/specs/<name>.md [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { readSpecDocumentFile } from "../src/schemas/persisted.js";
import { renderSpecBody } from "../src/domain/authoring/renderSpec.js";
import { splitFrontmatter } from "../src/domain/artifact/frontmatter.js";
import { sidecarPathFor } from "../src/domain/artifact/sidecar.js";

/**
 * The spec Markdown rendered from its sidecar, frontmatter kept, or the reason
 * it cannot be. The sidecar is a persisted spec document (`$schema` since
 * 0.17.0, `version: 1` before), read the way phax reads it.
 */
export function rerenderSpec(
  mdPath: string,
  md: string,
  sidecarPath: string,
  sidecar: unknown,
): Either.Either<string, string> {
  const split = splitFrontmatter(md);
  if (split === null) return Either.left(`${mdPath}: no frontmatter block`);
  const decoded = readSpecDocumentFile(sidecarPath, sidecar);
  if (Either.isLeft(decoded)) return Either.left(decoded.left.message);
  return Either.right(`---\n${split.yamlText}\n---\n${renderSpecBody(decoded.right)}`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const [mdPath, flag] = process.argv.slice(2);
  if (mdPath === undefined) {
    console.error("usage: tsx scripts/rerender-spec.ts <spec.md> [--check]");
    process.exit(2);
  }

  const md = readFileSync(mdPath, "utf8");
  const sidecarPath = sidecarPathFor(mdPath);
  const rendered = rerenderSpec(
    mdPath,
    md,
    sidecarPath,
    JSON.parse(readFileSync(sidecarPath, "utf8")),
  );
  if (Either.isLeft(rendered)) {
    console.error(rendered.left);
    process.exit(1);
  }

  const next = rendered.right;
  if (flag === "--check") {
    console.log(next === md ? "unchanged" : "would change");
    process.exit(next === md ? 0 : 1);
  }
  writeFileSync(mdPath, next);
  console.log(next === md ? `${mdPath}: unchanged` : `${mdPath}: re-rendered`);
}
