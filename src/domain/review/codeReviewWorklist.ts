import type { GlobalFileReconciliation } from "../../schemas/globalReconciliation.js";

export interface CodeReviewAttentionPoint {
  readonly path: string;
  readonly status: string;
  readonly phaseRef: string;
}

/**
 * Maps a decoded `GlobalFileReconciliation` to the prompt's worklist shape.
 *
 * `phaseRef` is the sorted, de-duplicated union of the phases that touched,
 * planned, or optionally listed the file. When all three are empty it falls
 * back to `"—"` so the prompt never renders an empty `phase:`.
 *
 * Input order is preserved — the reconciler already orders `attentionPoints`.
 */
export function toCodeReviewAttentionPoints(
  reconciliation: GlobalFileReconciliation,
): ReadonlyArray<CodeReviewAttentionPoint> {
  return reconciliation.attentionPoints.map((entry) => {
    const phases = [
      ...new Set([...entry.touchedInPhases, ...entry.plannedInPhases, ...entry.optionalInPhases]),
    ].toSorted();
    return {
      path: entry.path,
      status: entry.status,
      phaseRef: phases.length === 0 ? "—" : phases.join(", "),
    };
  });
}
