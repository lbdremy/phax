import { Effect, Either } from "effect";
import type { ScopesConfig } from "../schemas/phaxConfig.js";
import type { ScopesRequest } from "../domain/plan/projection.js";
import { ScopesProviderError } from "../domain/errors.js";
import { Shell } from "../ports/shell.js";
import { runProviderQuery } from "./providerQuery.js";
import { decodeScopesResponse, type ScopesResponse } from "../schemas/scopes.js";

export function queryClosedScopes(
  config: ScopesConfig,
  request: ScopesRequest,
  cwd: string,
): Effect.Effect<Either.Either<ScopesResponse, ScopesProviderError>, never, Shell> {
  return runProviderQuery(
    "Scope provider",
    config.command,
    cwd,
    request,
    decodeScopesResponse,
    (failure) => new ScopesProviderError(failure),
  );
}
