import { Effect, Either } from "effect";
import type { PlanAuditorConfig } from "../schemas/phaxConfig.js";
import type { PlanAuditRequest } from "../domain/plan/projection.js";
import { PlanAuditorError } from "../domain/errors.js";
import { Shell } from "../ports/shell.js";
import { runProviderQuery } from "./providerQuery.js";
import { decodePlanAuditResponse, type PlanAuditResponse } from "../schemas/planAudit.js";

export function queryPlanAuditor(
  config: PlanAuditorConfig,
  request: PlanAuditRequest,
  cwd: string,
): Effect.Effect<Either.Either<PlanAuditResponse, PlanAuditorError>, never, Shell> {
  return runProviderQuery(
    "Plan auditor",
    config.command,
    cwd,
    request,
    decodePlanAuditResponse,
    (failure) => new PlanAuditorError(failure),
  );
}
