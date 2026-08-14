import { Effect, Either, type ParseResult } from "effect";
import type { OrientConfig } from "../schemas/phaxConfig.js";
import { OrientProviderError } from "../domain/errors.js";
import { formatParseError } from "../schemas/formatError.js";
import { Shell } from "../ports/shell.js";
import {
  decodeOrientExpandResponse,
  decodeOrientIndexResponse,
  type OrientExpandResponse,
  type OrientIndexResponse,
} from "../schemas/orient.js";

// stderr from a misbehaving provider can be arbitrarily large; keep only a
// bounded head so the error stays loggable while still pointing at the cause.
const STDERR_EXCERPT_LIMIT = 2000;

export function excerpt(text: string): string {
  return text.length > STDERR_EXCERPT_LIMIT
    ? `${text.slice(0, STDERR_EXCERPT_LIMIT)}… (${text.length - STDERR_EXCERPT_LIMIT} more chars)`
    : text;
}

// `NonEmptyString` still admits a whitespace-only command, which tokenises to
// nothing. Returning `undefined` keeps that a typed provider failure — the
// channel is advisory, so it must never escape as a defect.
function parseCommandTokens(raw: string): readonly [string, ...string[]] | undefined {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (first === undefined) {
    return undefined;
  }
  return [first, ...parts.slice(1)];
}

function runOrientQuery<T>(
  config: OrientConfig,
  cwd: string,
  requestBody: unknown,
  decode: (input: unknown) => Either.Either<T, ParseResult.ParseError>,
): Effect.Effect<Either.Either<T, OrientProviderError>, never, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const command = parseCommandTokens(config.command);
    if (command === undefined) {
      return Either.left(
        new OrientProviderError({
          message: `Orient provider command is empty: "${config.command}"`,
        }),
      );
    }
    const ran = yield* Effect.either(
      shell.run({ command, cwd, stdin: JSON.stringify(requestBody) }),
    );

    if (Either.isLeft(ran)) {
      return Either.left(
        new OrientProviderError({
          message: ran.left.message,
        }),
      );
    }

    const { exitCode, stdout, stderr } = ran.right;
    if (exitCode !== 0) {
      return Either.left(
        new OrientProviderError({
          message: `Orient provider exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderrExcerpt: excerpt(stderr) } : {}),
        }),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout) as unknown;
    } catch (err) {
      return Either.left(
        new OrientProviderError({
          message: `Orient provider returned invalid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        }),
      );
    }

    const decoded = decode(parsed);
    if (Either.isLeft(decoded)) {
      return Either.left(
        new OrientProviderError({
          message: `Orient provider response failed schema validation:\n${formatParseError(
            decoded.left,
          )}`,
        }),
      );
    }

    return Either.right(decoded.right);
  });
}

export function queryOrientIndex(
  config: OrientConfig,
  files: readonly string[],
  cwd: string,
): Effect.Effect<Either.Either<OrientIndexResponse, OrientProviderError>, never, Shell> {
  return runOrientQuery(config, cwd, { files }, decodeOrientIndexResponse);
}

export function expandOrientRow(
  config: OrientConfig,
  id: string,
  cwd: string,
): Effect.Effect<Either.Either<OrientExpandResponse, OrientProviderError>, never, Shell> {
  return runOrientQuery(config, cwd, { expand: id }, decodeOrientExpandResponse);
}
