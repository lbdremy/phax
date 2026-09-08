import { Effect, Either, Schema } from "effect";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import {
  ExtractedPhaxPlanSchema,
  getExtractedPlanJsonSchema,
  type ExtractedPhaxPlan,
} from "../schemas/phaxPlan.js";
import {
  AgentInvocationError,
  PlanValidationError,
  RateLimitError,
  UsageLimitError,
} from "../domain/errors.js";
import { formatParseError } from "../schemas/formatError.js";

const decodeExtractedPlan = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

function buildExtractionPrompt(planMd: string, jsonSchema: object): string {
  return [
    "You are extracting structured phase data from a phax plan markdown document.",
    "",
    "Read the plan document below and return ONLY a valid JSON object that conforms to the provided JSON Schema.",
    "Rules:",
    "- Return raw JSON only. No markdown, no code fences, no explanation.",
    "- Do not invent phases that are not explicitly described in the document.",
    "- Do not guess missing required fields — if a field is missing, that is an error.",
    "- Extract ONLY what is explicitly stated.",
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

    const jsonSchema = getExtractedPlanJsonSchema();
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonCodeFence(runResult.finalText));
    } catch {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Claude returned non-JSON output. Raw response: ${runResult.finalText.slice(0, 300)}`,
        }),
      );
    }

    const decoded = decodeExtractedPlan(parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Extracted JSON failed schema validation:\n${formatParseError(decoded.left)}`,
        }),
      );
    }

    return decoded.right;
  });
}

// Claude sometimes wraps JSON output in a ```json fence despite the prompt
// forbidding it. Strip a single leading/trailing fence so JSON.parse succeeds.
function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fence);
  return match?.[1]?.trim() ?? trimmed;
}
