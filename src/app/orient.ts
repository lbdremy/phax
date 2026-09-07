import { Effect, Either } from "effect";
import type { OrientConfig } from "../schemas/phaxConfig.js";
import { OrientProviderError } from "../domain/errors.js";
import { Shell } from "../ports/shell.js";
import { runProviderQuery } from "./providerQuery.js";
import {
  decodeOrientExpandResponse,
  decodeOrientIndexResponse,
  type OrientExpandResponse,
  type OrientIndexResponse,
} from "../schemas/orient.js";

export { excerpt } from "./providerQuery.js";

function makeOrientError(failure: {
  message: string;
  exitCode?: number;
  stderrExcerpt?: string;
}): OrientProviderError {
  return new OrientProviderError(failure);
}

export function queryOrientIndex(
  config: OrientConfig,
  files: readonly string[],
  cwd: string,
): Effect.Effect<Either.Either<OrientIndexResponse, OrientProviderError>, never, Shell> {
  return runProviderQuery(
    "Orient provider",
    config.command,
    cwd,
    { files },
    decodeOrientIndexResponse,
    makeOrientError,
  );
}

export function expandOrientRow(
  config: OrientConfig,
  id: string,
  cwd: string,
): Effect.Effect<Either.Either<OrientExpandResponse, OrientProviderError>, never, Shell> {
  return runProviderQuery(
    "Orient provider",
    config.command,
    cwd,
    { expand: id },
    decodeOrientExpandResponse,
    makeOrientError,
  );
}
