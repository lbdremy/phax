import { Effect, Either } from "effect";
import type { PlanAuditorConfig } from "../schemas/phaxConfig.js";
import type { PlanAuditRequest } from "../domain/plan/projection.js";
import { PlanAuditorError } from "../domain/errors.js";
import { Shell } from "../ports/shell.js";
import { runProviderQuery } from "./providerQuery.js";
import { decodePlanAuditResponse, type PlanAuditResponse } from "../schemas/planAudit.js";

/**
 * `phax plans lint` is documented as a fast, read-only check, so the auditor is
 * capped: a wedged provider becomes an advisory warning like any other failure
 * instead of hanging the lint. Auditing a projection is mechanical work, so the
 * cap is generous rather than tight.
 */
const PLAN_AUDITOR_TIMEOUT_MS = 30_000;

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
    { timeoutMs: PLAN_AUDITOR_TIMEOUT_MS },
  );
}
