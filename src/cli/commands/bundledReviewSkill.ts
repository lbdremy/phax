import { Effect } from "effect";
import { join } from "node:path";
import { FileSystem } from "../../ports/fs.js";
import type { OutputPort } from "../../ports/output.js";
import { PHAX_REVIEW_SKILL } from "../../domain/skills/catalog.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
// From the definition, not the kept run function's module: that one imports the bridge, which
// imports phaxProgram, which holds the run and resume definitions that import this module.
import { defaultBundleRoot } from "../definitions/skills.js";

/**
 * The bundled phax-review SKILL.md `executePlan` needs for the run-end code
 * review, or `undefined` when `review.code.enabled` is off or the read failed
 * (a warning names the path and the error, so the run end does not repeat one).
 */
export function readBundledReviewSkillForRun(
  config: ResolvedConfig,
  out: OutputPort,
): Effect.Effect<string | undefined, never, FileSystem> {
  if (!config.codeReview.enabled) return Effect.succeed(undefined);
  const path = join(defaultBundleRoot(), PHAX_REVIEW_SKILL, "SKILL.md");
  return Effect.flatMap(FileSystem, (fs) => fs.readText(path)).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        out.warn(
          `[phax] Warning: code review not run: could not read the bundled phax-review skill at ${path} (${error.message})`,
        );
        return undefined;
      }),
    ),
  );
}
