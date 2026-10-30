import { Effect, Either, Schema } from "effect";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { ExtractedPhaxPlanSchema, type ExtractedPhaxPlan } from "../schemas/phaxPlan.js";
import { answerJsonSchema } from "../schemas/answerSchemas.js";
import { readPlanExtractionAnswer } from "../schemas/planExtraction.js";
import { CURRENT_STAMPS } from "../schemas/release.js";
import { schemaUrl } from "../schemas/schemaUrl.js";
import { withPhaseKinds } from "../domain/plan/phaseHeader.js";
import {
  AgentInvocationError,
  type AgentSessionFailedError,
  PlanValidationError,
  RateLimitError,
  UsageLimitError,
} from "../domain/errors.js";
import { formatParseError } from "../schemas/formatError.js";
import { answerJson } from "../domain/session/structuredAnswer.js";

const decodeExtractedPlan = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

function buildExtractionPrompt(planMd: string, jsonSchema: object): string {
  const stamp = schemaUrl("phax-plan-extraction", CURRENT_STAMPS["phax-plan-extraction"]);
  return [
    "You are extracting structured phase data from a phax plan markdown document.",
    "",
    "Read the plan document below and return ONLY a valid JSON object that conforms to the provided JSON Schema.",
    "Rules:",
    "- Return raw JSON only. No markdown, no code fences, no explanation.",
    `- "$schema" is exactly ${JSON.stringify(stamp)}. Exactly one of "plan" and "incomplete" is null.`,
    "- Do not invent phases that are not explicitly described in the document.",
    "- Do not guess missing required fields — if a field is missing, that is an error.",
    "- Extract ONLY what is explicitly stated.",
    "- run.title and run.shortName are both the text of the plan's single `# ` heading, verbatim; phax slugifies the short name itself.",
    "- A phase's testLines holds one entry per item of its `### Test strategy` section, in order. Each item reads `<guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`; copy every coordinate verbatim, with criterion null when the line names none.",
    "- testLines is [] for a phase whose `### Test strategy` section is absent, empty or `- (none)`.",
    `- If a test strategy item is not in that line format, return {"$schema": ${JSON.stringify(stamp)}, "plan": null, "incomplete": "<the phase and the item>"} instead of the plan.`,
    `- If a required field really is missing, return {"$schema": ${JSON.stringify(stamp)}, "plan": null, "incomplete": "<what is missing>"} instead of the plan.`,
    "",
    "JSON Schema:",
    JSON.stringify(jsonSchema, null, 2),
    "",
    "Plan document:",
    planMd,
  ].join("\n");
}

export type ExtractPlanError =
  | PlanValidationError
  | AgentInvocationError
  | AgentSessionFailedError
  | RateLimitError
  | UsageLimitError
  | FsError;

/**
 * The cacheable LLM step: takes the plan.md text, calls backend.complete in a
 * throwaway temp dir, parses/validates the JSON response, and returns the
 * validated ExtractedPhaxPlan. Does not read the md from disk — the caller
 * supplies the text so the cache loader can pass a cached text without a path.
 */
export function extractPlanLlm(
  planMd: string,
  opts: { model: string; effort: string },
): Effect.Effect<ExtractedPhaxPlan, ExtractPlanError, Backend | FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;

    const jsonSchema = answerJsonSchema("phax-plan-extraction");
    const prompt = buildExtractionPrompt(planMd, jsonSchema);

    const tempDir = join(tmpdir(), "phax-extract-" + randomUUID());
    const runResult = yield* Effect.acquireUseRelease(
      fs.mkdirp(tempDir).pipe(Effect.as(tempDir)),
      (dir) =>
        backend.complete(prompt, {
          provider: "claude-code",
          model: opts.model,
          effort: opts.effort,
          cwd: dir,
        }),
      (dir) => fs.remove(dir).pipe(Effect.orElse(() => Effect.void)),
    );

    const parsed = answerJson(runResult);
    if (Either.isLeft(parsed)) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Claude returned non-JSON output. Raw response: ${runResult.finalText.slice(0, 300)}`,
        }),
      );
    }

    const answer = readPlanExtractionAnswer(parsed.right);
    if (Either.isLeft(answer)) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Extracted JSON failed schema validation: ${answer.left}`,
        }),
      );
    }
    if (answer.right.kind === "incomplete") {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `The extraction model found the plan incomplete: ${answer.right.reason}`,
        }),
      );
    }

    // mode and oracle are phax's own reading of the header lines, never the model's.
    const kinded = withPhaseKinds(answer.right.plan, planMd);
    if (Either.isLeft(kinded)) return yield* Effect.fail(kinded.left);

    const decoded = decodeExtractedPlan({ version: 1, ...kinded.right });
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Extracted plan failed schema validation:\n${formatParseError(decoded.left)}`,
        }),
      );
    }

    return decoded.right;
  });
}
