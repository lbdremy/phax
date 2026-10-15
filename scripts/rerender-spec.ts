// Re-renders a headless-authored spec's Markdown body from its JSON sidecar,
// keeping the frontmatter as is: applies a hand edit made to the sidecar to
// the body, in the current layout. It reads only a sidecar at the current
// spec-document shape; an older one is migrated first by
// `phax artifact migrate-documents`, which rewrites the sidecar with the body.
// Run with: pnpm exec tsx scripts/rerender-spec.ts docs/specs/<name>.md [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { readDocumentSidecar } from "../src/schemas/persisted.js";
import { renderSpecBody } from "../src/domain/authoring/renderSpec.js";
import { splitFrontmatter } from "../src/domain/artifact/frontmatter.js";
import { describeStampedShape, sidecarPathFor } from "../src/domain/artifact/sidecar.js";

/**
 * The spec Markdown rendered from its sidecar, frontmatter kept, or the reason
 * it cannot be. The sidecar is read the way phax reads it; one below the
 * current shape is refused, since re-rendering its lifted document while the
 * file stays older would leave the pair diverged.
 */
export function rerenderSpec(
  mdPath: string,
  md: string,
  sidecarPath: string,
  sidecar: unknown,
): Either.Either<string, string> {
  const split = splitFrontmatter(md);
  if (split === null) return Either.left(`${mdPath}: no frontmatter block`);
  const read = readDocumentSidecar("spec", sidecarPath, sidecar);
  if (Either.isLeft(read)) return Either.left(read.left.message);
  if (read.right.shape !== "current") {
    return Either.left(
      `${sidecarPath}: stamped ${describeStampedShape("spec-document", read.right.shape)} — run \`phax artifact migrate-documents\` first`,
    );
  }
  return Either.right(`---\n${split.yamlText}\n---\n${renderSpecBody(read.right.document)}`);
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
