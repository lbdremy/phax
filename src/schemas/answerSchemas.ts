// The answer formats: each provider answer phax asks for as a structured value,
// with the one schema it is decoded by. `answerJsonSchema(format)` renders that
// schema once, exactly as packages/schemas publishes it
// (packages/schemas/json/<format>.schema.json), and is what the prompts state
// and what the provider flags hand over. No answer schema imports this module:
// it imports them (the stamp they need lives in answerStamp.ts).
import { CodeReviewFileSchema } from "./codeReview.js";
import { FirstReadingFileSchema } from "./firstReading.js";
import { InteractiveHandoffFileSchema } from "./interactiveHandoff.js";
import { PlanExtractionAnswerSchema } from "./planExtraction.js";
import { renderPublishedJsonSchema } from "./publishedJsonSchema.js";
import type { FormatId } from "./schemaUrl.js";

/** Every answer format, its label (the build's `phax <label>` title) and its schema. */
export const ANSWER_FORMATS = {
  "first-reading": { label: "first reading", schema: FirstReadingFileSchema },
  "interactive-handoff": { label: "interactive handoff", schema: InteractiveHandoffFileSchema },
  "code-review": { label: "code review", schema: CodeReviewFileSchema },
  "phax-plan-extraction": { label: "plan extraction", schema: PlanExtractionAnswerSchema },
} as const satisfies Partial<
  Record<FormatId, { readonly label: string; readonly schema: unknown }>
>;

export type AnswerFormatId = keyof typeof ANSWER_FORMATS;

/**
 * The published JSON Schema of an answer format: the object
 * packages/schemas/json/<format>.schema.json holds. Every answer's decoder
 * refuses a key it does not name.
 */
export function answerJsonSchema(format: AnswerFormatId): Record<string, unknown> {
  const { label, schema } = ANSWER_FORMATS[format];
  return renderPublishedJsonSchema({ schema, title: `phax ${label}`, excess: "error" });
}
