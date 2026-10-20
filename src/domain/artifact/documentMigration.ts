import { Either } from "effect";
import type { DocumentSidecar } from "../../schemas/persisted.js";
import { CURRENT_STAMPS } from "../../schemas/release.js";
import { compareReleases } from "../../schemas/schemaUrl.js";
import { renderPlanBody } from "../authoring/renderPlan.js";
import { renderPlanBodyV0_25_0 } from "../authoring/renderPlanV0_25_0.js";
import { renderSpecBodyV0_17_0 } from "../authoring/renderSpecV0_17_0.js";
import { validateArtifact } from "./document.js";
import { parseArtifactName } from "./name.js";
import { type QuestionSummary, summarizeDocumentQuestions } from "./questions.js";
import {
  type DocumentFormat,
  type OlderDocumentShape,
  type SidecarDocument,
  artifactBody,
  describeStampedShape,
  inspectSidecar,
  renderCurrent,
  sameRendering,
  serializeSidecar,
  sidecarRemedy,
} from "./sidecar.js";
import type { ArtifactKind, ArtifactStatus } from "./status.js";

// `phax artifact migrate-documents`, decided per sidecar from text alone: an
// older sidecar is migrated only while its body is still the rendering of its
// own shape, so no hand edit is ever overwritten. Pure: the app layer reads
// the files, checks git and approval records, and writes.

export const DOCUMENT_MIGRATION_COMMIT_SUBJECT =
  "chore(artifacts): migrate documents to their current shapes";

/** One live sidecar stamped below its format's current shape, with its artifact, as read. */
export interface DocumentMigrationInput {
  readonly kind: ArtifactKind;
  /** The artifact's repo-relative path. */
  readonly path: string;
  readonly sidecarPath: string;
  readonly md: string;
  readonly sidecarJson: string;
}

/** A refused artifact: `<path> <problem>`, then the way out. */
export interface DocumentMigrationRefusal {
  readonly path: string;
  readonly problem: string;
  readonly remedy: string;
}

/** An artifact migration rewrites: its new sidecar text, and its new md, frontmatter kept byte for byte. */
export interface DocumentMigration {
  readonly kind: ArtifactKind;
  readonly path: string;
  readonly sidecarPath: string;
  readonly status: ArtifactStatus;
  readonly format: DocumentFormat;
  readonly fromShape: OlderDocumentShape;
  /** The lifted document, at the current in-memory shape. */
  readonly document: SidecarDocument;
  readonly sidecarText: string;
  readonly md: string;
  /** Whether `md` differs from the artifact as read; an unchanged md is never written. */
  readonly bodyChanged: boolean;
  readonly questions: QuestionSummary;
}

export type DocumentMigrationDecision =
  | { readonly kind: "migrate"; readonly migration: DocumentMigration }
  | { readonly kind: "refuse"; readonly refusal: DocumentMigrationRefusal };

function refuse(path: string, problem: string, remedy: string): DocumentMigrationDecision {
  return { kind: "refuse", refusal: { path, problem, remedy } };
}

function formatOf(kind: ArtifactKind): DocumentFormat {
  return kind === "spec" ? "spec-document" : "plan-document";
}

// The body the sidecar's own shape renders: the rendering frozen at
// spec-document 0.17.0, the one frozen at plan-document 0.25.0 (its
// `**Model reason:**` lines), or the plan renderer for the older plan shapes,
// whose lifted reason is null and whose output did not change.
function renderOwnShape(sidecar: Exclude<DocumentSidecar, { readonly shape: "current" }>): string {
  if (sidecar.kind === "spec") return renderSpecBodyV0_17_0(sidecar.older);
  return sidecar.shape === "0.25.0"
    ? renderPlanBodyV0_25_0(sidecar.older)
    : renderPlanBody(sidecar.document);
}

/**
 * Whether and how one older sidecar migrates. Refused when the artifact is
 * not a valid spec or plan, when the sidecar does not decode (a refused older
 * shape included), or when the body is not the sidecar's own-shape rendering
 * (compared as agreement compares). Otherwise the sidecar is rewritten at the
 * current shape and the body re-rendered in the current layout; a body whose
 * rendering did not change keeps its md untouched.
 */
export function decideDocumentMigration(input: DocumentMigrationInput): DocumentMigrationDecision {
  const { kind, path, sidecarPath, md } = input;
  const slug = parseArtifactName(kind, path.slice(path.lastIndexOf("/") + 1))?.slug ?? path;
  const remedy = `${sidecarRemedy(kind, slug, sidecarPath)} Then rerun.`;

  const validated = validateArtifact(path, md);
  if (Either.isLeft(validated)) {
    return refuse(
      path,
      `cannot be read — ${validated.left.message}`,
      "Fix its frontmatter, then rerun.",
    );
  }

  const { agreement, sidecar } = inspectSidecar({
    md,
    sidecarJson: input.sidecarJson,
    kind,
    sidecarPath,
  });
  if (sidecar === null) {
    const message =
      typeof agreement === "object" && agreement.kind === "invalid" ? agreement.message : "";
    return refuse(path, `has an invalid sidecar (${message})`, remedy);
  }
  if (sidecar.shape === "current") {
    return refuse(path, `has a sidecar already at its current shape`, "Nothing to migrate for it.");
  }

  const format = formatOf(kind);
  const ownShape = renderOwnShape(sidecar);
  const body = artifactBody(md);
  if (!sameRendering(body, ownShape)) {
    return refuse(
      path,
      `is not its sidecar's ${describeStampedShape(format, sidecar.shape)} rendering — a hand edit would be overwritten`,
      remedy,
    );
  }

  const document: SidecarDocument =
    sidecar.kind === "spec"
      ? { kind: "spec", document: sidecar.document }
      : { kind: "plan", document: sidecar.document };
  const current = renderCurrent(document);
  // The frontmatter block as written, byte for byte: everything before the body.
  const newMd = sameRendering(current, ownShape)
    ? md
    : md.slice(0, md.length - body.length) + current;
  const arrays = document.kind === "spec" ? document.document : document.document.preamble;

  return {
    kind: "migrate",
    migration: {
      kind,
      path,
      sidecarPath,
      status: validated.right.status,
      format,
      fromShape: sidecar.shape,
      document,
      sidecarText: serializeSidecar(document),
      md: newMd,
      bodyChanged: newMd !== md,
      questions: summarizeDocumentQuestions(arrays),
    },
  };
}

// ── Report ─────────────────────────────────────────────────────────────────

/** A migrated artifact as the report names it. */
export interface MigratedArtifact {
  readonly path: string;
  readonly status: ArtifactStatus;
  readonly questions: QuestionSummary;
  readonly bodyChanged: boolean;
  /** An Approved artifact whose approval record no longer matches its new text. */
  readonly editedSinceApproval: boolean;
}

/** The artifacts of one format migrated from one older shape, sorted by path. */
export interface DocumentMigrationGroup {
  readonly format: DocumentFormat;
  readonly fromShape: OlderDocumentShape;
  readonly toShape: string;
  readonly artifacts: readonly MigratedArtifact[];
}

/** A live plan whose approval recorded a spec the migration re-rendered. */
export interface PlanLeftStale {
  readonly path: string;
  readonly specPath: string;
}

/** The outcome of `phax artifact migrate-documents`. */
export type DocumentMigrationResult =
  | { readonly kind: "nothing-to-migrate" }
  | {
      readonly kind: "migrated";
      readonly groups: readonly DocumentMigrationGroup[];
      readonly stalePlans: readonly PlanLeftStale[];
      readonly commit: { readonly hash: string; readonly subject: string };
    };

const FORMAT_ORDER: readonly DocumentFormat[] = ["spec-document", "plan-document"];

// Releases first, oldest first; the shape written before `$schema` last.
function compareShapes(a: OlderDocumentShape, b: OlderDocumentShape): number {
  if (a === b) return 0;
  if (a === "pre-schema") return 1;
  if (b === "pre-schema") return -1;
  return compareReleases(a, b);
}

/**
 * Groups migrated artifacts by format (specs first) and older shape, each
 * group naming its format's current stamp; artifacts sorted by path.
 */
export function groupMigratedArtifacts(
  entries: ReadonlyArray<{
    readonly migration: DocumentMigration;
    readonly editedSinceApproval: boolean;
  }>,
): readonly DocumentMigrationGroup[] {
  const groups: DocumentMigrationGroup[] = [];
  for (const format of FORMAT_ORDER) {
    const ofFormat = entries.filter((e) => e.migration.format === format);
    const shapes = [...new Set(ofFormat.map((e) => e.migration.fromShape))].toSorted(compareShapes);
    for (const fromShape of shapes) {
      const artifacts = ofFormat
        .filter((e) => e.migration.fromShape === fromShape)
        .map(({ migration, editedSinceApproval }) => ({
          path: migration.path,
          status: migration.status,
          questions: migration.questions,
          bodyChanged: migration.bodyChanged,
          editedSinceApproval,
        }))
        .toSorted((a, b) => (a.path < b.path ? -1 : 1));
      groups.push({ format, fromShape, toShape: CURRENT_STAMPS[format], artifacts });
    }
  }
  return groups;
}

/** The migration commit's body: one line per rewritten artifact. */
export function documentMigrationCommitBody(migrations: readonly DocumentMigration[]): string {
  const lines = migrations.map(
    (m) =>
      `- ${m.path}: ${describeStampedShape(m.format, m.fromShape)} → ${CURRENT_STAMPS[m.format]}` +
      (m.bodyChanged ? "" : " (body unchanged)"),
  );
  return [
    "Rewrite each live spec and plan sidecar stamped below its format's current shape, and re-render its body.",
    "",
    ...lines,
  ].join("\n");
}
