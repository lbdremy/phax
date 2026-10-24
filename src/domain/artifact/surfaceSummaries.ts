import type { DocumentSidecar } from "../../schemas/persisted.js";
import { SURFACE_SUMMARY_PLACEHOLDER, type SpecDocument } from "../../schemas/specDocument.js";

// The surface elements whose summary is still the placeholder `phax artifact
// migrate-documents` lifts in. Pure: matched by exact string equality.

/** How many of a spec document's surface elements still hold the placeholder. */
export function summariesToWrite(document: SpecDocument): number {
  return document.surface.filter((e) => e.summary === SURFACE_SUMMARY_PLACEHOLDER).length;
}

/**
 * The `surface` value of each element still holding the placeholder, in
 * document order, read only from a spec sidecar decoded at the current shape.
 * A sidecar stamped below it holds no summary at all: the placeholders its
 * in-memory lift carries are the reader's, not the file's, so they never
 * refuse. A plan and a hand-authored artifact (null) have none.
 */
export function unwrittenSummaries(sidecar: DocumentSidecar | null): readonly string[] {
  if (sidecar === null || sidecar.kind !== "spec" || sidecar.shape !== "current") return [];
  return sidecar.document.surface
    .filter((e) => e.summary === SURFACE_SUMMARY_PLACEHOLDER)
    .map((e) => e.surface);
}
