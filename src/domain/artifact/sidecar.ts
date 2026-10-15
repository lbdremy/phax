import { Either } from "effect";
import {
  type DocumentSidecar,
  type PersistedReadError,
  readDocumentSidecar,
  withSchemaUrl,
} from "../../schemas/persisted.js";
import { encodePlanDocumentFile, type PlanDocument } from "../../schemas/planDocument.js";
import { encodeSpecDocumentFile, type SpecDocument } from "../../schemas/specDocument.js";
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

/** The document format of a spec's or plan's sidecar. */
export type DocumentFormat = "spec-document" | "plan-document";

/** A sidecar shape below its format's current one that phax still lifts. */
export type OlderDocumentShape = Exclude<DocumentSidecar["shape"], "current">;

export type SidecarAgreement =
  | "in-sync"
  | "diverged"
  | { readonly kind: "invalid"; readonly message: string }
  /** Stamped below its format's current shape, or written before `$schema`: lifted, never compared. */
  | {
      readonly kind: "unmigrated";
      readonly format: DocumentFormat;
      readonly shape: OlderDocumentShape;
    };

/**
 * `spec-document 0.17.0`, or `spec-document written before $schema`: the
 * shape a sidecar is stamped at. `shape` is a release or `pre-schema`; a
 * refused older stamp (a plan at 0.19.0) is named the same way.
 */
export function describeStampedShape(format: DocumentFormat, shape: string): string {
  return shape === "pre-schema" ? `${format} written before $schema` : `${format} ${shape}`;
}

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

/**
 * Whether two Markdown texts agree up to line endings and trailing
 * whitespace: the comparison agreement makes between a body and its sidecar's
 * rendering.
 */
export function sameRendering(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

/** An artifact's body: the text after its frontmatter block, or the whole text without one. */
export function artifactBody(md: string): string {
  return splitFrontmatter(md)?.body ?? md;
}

/** A spec's or plan's document at the current in-memory shape, as its sidecar holds it. */
export type SidecarDocument =
  | { readonly kind: "spec"; readonly document: SpecDocument }
  | { readonly kind: "plan"; readonly document: PlanDocument };

/**
 * The sidecar text phax writes for a document: encoded through the current
 * file schema with `$schema` first, as two-space JSON with a final newline.
 * Authoring and `phax artifact migrate-documents` both write through it.
 */
export function serializeSidecar(sidecar: SidecarDocument): string {
  const encoded =
    sidecar.kind === "spec"
      ? encodeSpecDocumentFile(withSchemaUrl("spec-document", sidecar.document))
      : encodePlanDocumentFile(withSchemaUrl("plan-document", sidecar.document));
  return JSON.stringify(encoded, null, 2) + "\n";
}

function readSidecarJson(
  kind: ArtifactKind,
  sidecarJson: string,
  sidecarPath: string,
): Either.Either<DocumentSidecar, { readonly kind: "invalid"; readonly message: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sidecarJson);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Either.left({ kind: "invalid", message: `not JSON (${detail})` });
  }
  const decoded: Either.Either<DocumentSidecar, PersistedReadError> =
    kind === "spec"
      ? readDocumentSidecar("spec", sidecarPath, parsed)
      : readDocumentSidecar("plan", sidecarPath, parsed);
  return Either.mapLeft(decoded, (error) => ({ kind: "invalid", message: error.message }));
}

/** The body phax renders for a document at the current shape. */
export function renderCurrent(sidecar: SidecarDocument): string {
  return sidecar.kind === "spec"
    ? renderSpecBody(sidecar.document)
    : renderPlanBody(sidecar.document);
}

/** The ways out of a diverged or invalid sidecar, as `artifact approve` names them. */
export function sidecarRemedy(kind: ArtifactKind, slug: string, sidecarPath: string): string {
  return (
    `Re-author it headless (remove the artifact and its sidecar, then run ` +
    `\`phax artifact new ${kind} ${slug} --headless --brief <file|->\`), ` +
    `or delete ${sidecarPath} to demote the artifact to hand-authored.`
  );
}

export interface SidecarInput {
  readonly md: string;
  readonly sidecarJson: string;
  readonly kind: ArtifactKind;
  readonly sidecarPath?: string;
}

/** A sidecar's agreement, and the sidecar as read whenever it decodes (every agreement but `invalid`). */
export interface SidecarInspection {
  readonly agreement: SidecarAgreement;
  readonly sidecar: DocumentSidecar | null;
}

/**
 * Whether an artifact's body is still the rendering of its sidecar. Computed
 * from content only: the frontmatter is ignored (transitions rewrite it), so a
 * status change or approval stamp keeps the pair in sync while any body edit
 * diverges it. Agreement compares with the rendering at the current shape
 * only: a sidecar stamped below its format's current shape, or written before
 * `$schema`, is `unmigrated` and not compared — `phax artifact
 * migrate-documents` rewrites it. A sidecar that is not a valid document of
 * `kind`, including a refused older shape, is `invalid`; its message names
 * `sidecarPath`, or "sidecar" when the caller has none.
 */
export function inspectSidecar(input: SidecarInput): SidecarInspection {
  const read = readSidecarJson(input.kind, input.sidecarJson, input.sidecarPath ?? "sidecar");
  if (Either.isLeft(read)) return { agreement: read.left, sidecar: null };
  const sidecar = read.right;
  if (sidecar.shape !== "current") {
    const format = sidecar.kind === "spec" ? "spec-document" : "plan-document";
    return { agreement: { kind: "unmigrated", format, shape: sidecar.shape }, sidecar };
  }
  const agreement = sameRendering(artifactBody(input.md), renderCurrent(sidecar))
    ? "in-sync"
    : "diverged";
  return { agreement, sidecar };
}

/** The agreement of `inspectSidecar`. */
export function sidecarAgreement(input: SidecarInput): SidecarAgreement {
  return inspectSidecar(input).agreement;
}
