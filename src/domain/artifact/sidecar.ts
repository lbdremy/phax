import { Either } from "effect";
import { formatFirstViolation } from "../../schemas/formatError.js";
import { decodePlanDocument } from "../../schemas/planDocument.js";
import { decodeSpecDocument } from "../../schemas/specDocument.js";
import { renderPlanBody } from "../authoring/renderPlan.js";
import { renderSpecBody } from "../authoring/renderSpec.js";
import { splitFrontmatter } from "./frontmatter.js";
import type { ArtifactKind } from "./status.js";

/**
 * The JSON sidecar beside a headless-authored artifact: `<name>.md` →
 * `<name>.json`, in the same directory. Applied to an archived path it yields
 * the archived sidecar, so `sidecarPathFor(archivePathFor(p))` and
 * `archivePathFor(sidecarPathFor(p))` agree.
 */
export function sidecarPathFor(repoRelPath: string): string {
  return repoRelPath.endsWith(".md")
    ? `${repoRelPath.slice(0, -".md".length)}.json`
    : `${repoRelPath}.json`;
}

export type SidecarAgreement =
  | "in-sync"
  | "diverged"
  | { readonly kind: "invalid"; readonly message: string };

// Line endings to `\n`, trailing whitespace dropped from every line and from
// the end of the text: an editor's whitespace trimming is not a divergence.
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function renderSidecar(
  kind: ArtifactKind,
  sidecarJson: string,
): Either.Either<string, { readonly kind: "invalid"; readonly message: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecarJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Either.left({ kind: "invalid", message: `not JSON (${detail})` });
  }
  if (kind === "spec") {
    const decoded = decodeSpecDocument(parsed);
    return Either.isLeft(decoded)
      ? Either.left({ kind: "invalid", message: formatFirstViolation(decoded.left) })
      : Either.right(renderSpecBody(decoded.right));
  }
  const decoded = decodePlanDocument(parsed);
  return Either.isLeft(decoded)
    ? Either.left({ kind: "invalid", message: formatFirstViolation(decoded.left) })
    : Either.right(renderPlanBody(decoded.right));
}

/** The ways out of a diverged or invalid sidecar, as `artifact approve` names them. */
export function sidecarRemedy(kind: ArtifactKind, slug: string, sidecarPath: string): string {
  return (
    `Re-author it headless (remove the artifact and its sidecar, then run ` +
    `\`phax artifact new ${kind} ${slug} --headless --brief <file|->\`), ` +
    `or delete ${sidecarPath} to demote the artifact to hand-authored.`
  );
}

/**
 * Whether an artifact's body is still the rendering of its sidecar. Computed
 * from content only: the frontmatter is ignored (transitions rewrite it), so a
 * status change or approval stamp keeps the pair in sync while any body edit
 * diverges it. A sidecar that is not a valid document of `kind` is `invalid`.
 */
export function sidecarAgreement(input: {
  readonly md: string;
  readonly sidecarJson: string;
  readonly kind: ArtifactKind;
}): SidecarAgreement {
  const rendered = renderSidecar(input.kind, input.sidecarJson);
  if (Either.isLeft(rendered)) return rendered.left;
  const body = splitFrontmatter(input.md)?.body ?? input.md;
  return normalise(body) === normalise(rendered.right) ? "in-sync" : "diverged";
}
