import { readFileSync } from "node:fs";
import { Either } from "effect";
import { PlanValidationError } from "../domain/errors.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import { readPhaxPlanFile, type PhaxPlanShape } from "../schemas/persisted.js";

export type LoadPlanError = PlanValidationError;

/**
 * Why a `phax-plan.json` an older phax wrote is never handed to a run, and the
 * two ways out. `run` names the run in the remedy, `<run>` when the caller
 * does not know it.
 */
export function olderPhaxPlanMessage(
  planPath: string,
  shape: Exclude<PhaxPlanShape, "current">,
  run = "<run>",
): string {
  const named = shape === "pre-schema" ? "written before $schema" : `in the ${shape} shape`;
  return (
    `${planPath}: phax-plan ${named} — an older phax wrote it, and this phax does not run a plan in that shape. ` +
    `Finish the run with the phax release that started it, or archive it with ` +
    `\`phax archive ${run} --force\` and run its plan again.`
  );
}

/**
 * Reads a run's `phax-plan.json` to hand it to a run (`phax resume`,
 * `phax validate --plan`): only the current shape is accepted. An older
 * shape is refused with `olderPhaxPlanMessage`.
 */
export function loadPlan(
  planPath: string,
  opts: { readonly run?: string } = {},
): Either.Either<PhaxPlan, LoadPlanError> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(planPath, "utf8"));
  } catch (err) {
    return Either.left(
      new PlanValidationError({
        message: `Failed to read or parse "${planPath}": ${String(err)}`,
        path: planPath,
      }),
    );
  }

  const decoded = readPhaxPlanFile(planPath, raw);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new PlanValidationError({
        message: decoded.left.message,
        path: planPath,
      }),
    );
  }

  const { shape, plan } = decoded.right;
  if (shape !== "current") {
    return Either.left(
      new PlanValidationError({
        message: olderPhaxPlanMessage(planPath, shape, opts.run),
        path: planPath,
      }),
    );
  }

  return Either.right(plan);
}
