// The round trip a rendered plan goes through: deterministic extraction, then finalize on both
// the extraction and the document's projection, against the same Markdown. Shared by the
// renderPlan examples and the plan-parser round-trip property.
import { Result } from "effect";
import { finalizeExtractedPlan } from "../../src/domain/plan/finalize.js";
import { extractPlanDeterministic } from "../../src/domain/plan/parsePlanMarkdown.js";
import { projectExtractedPlan, type PlanDocument } from "../../src/schemas/planDocument.js";

/**
 * Extracts `md` and finalizes both the extraction and `doc`'s projection against it. Throws an
 * `Error` naming the refusal when extraction or either finalize fails.
 */
export function roundTrip(doc: PlanDocument, md: string) {
  const parsed = extractPlanDeterministic(md);
  if (Result.isFailure(parsed))
    throw new Error(`rendered plan does not parse: ${parsed.failure.message}`);
  const fromMarkdown = finalizeExtractedPlan(parsed.success, md);
  if (Result.isFailure(fromMarkdown))
    throw new Error(`finalize failed on the extraction: ${fromMarkdown.failure.message}`);
  const fromDocument = finalizeExtractedPlan(projectExtractedPlan(doc), md);
  if (Result.isFailure(fromDocument))
    throw new Error(`finalize failed on the projection: ${fromDocument.failure.message}`);
  return {
    parsed: parsed.success,
    fromMarkdown: fromMarkdown.success,
    fromDocument: fromDocument.success,
  };
}
