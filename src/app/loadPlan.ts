import { readFileSync } from "node:fs";
import { Either } from "effect";
import { PlanValidationError } from "../domain/errors.js";
import type { PhaxPlan } from "../schemas/phaxPlan.js";
import { readPhaxPlanFile } from "../schemas/persisted.js";

export type LoadPlanError = PlanValidationError;

export function loadPlan(planPath: string): Either.Either<PhaxPlan, LoadPlanError> {
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

  return Either.right(decoded.right);
}
