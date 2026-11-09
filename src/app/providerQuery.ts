import { Effect, Result, type Schema } from "effect";
import { formatParseError } from "../schemas/formatError.js";
import { Shell } from "../ports/shell.js";

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

export interface ProviderQueryFailure {
  readonly message: string;
  readonly exitCode?: number;
  readonly stderrExcerpt?: string;
}

export interface ProviderQueryOptions {
  /**
   * Wall-clock cap on the provider. Left unset for providers that may legitimately
   * think for a while; set it where the caller is a command the user expects to
   * return promptly, so a wedged provider cannot wedge that command.
   */
  readonly timeoutMs?: number;
}

export function runProviderQuery<T, E>(
  providerLabel: string,
  command: string,
  cwd: string,
  requestBody: unknown,
  decode: (input: unknown) => Result.Result<T, Schema.SchemaError>,
  makeError: (failure: ProviderQueryFailure) => E,
  options: ProviderQueryOptions = {},
): Effect.Effect<Result.Result<T, E>, never, Shell> {
  return Effect.gen(function* () {
    const shell = yield* Shell;
    const tokens = parseCommandTokens(command);
    if (tokens === undefined) {
      return Result.fail(makeError({ message: `${providerLabel} command is empty: "${command}"` }));
    }
    const ran = yield* Effect.result(
      shell.run({
        command: tokens,
        cwd,
        stdin: JSON.stringify(requestBody),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      }),
    );

    if (Result.isFailure(ran)) {
      return Result.fail(makeError({ message: `${providerLabel} ${ran.left.message}` }));
    }

    const { exitCode, stdout, stderr } = ran.right;
    if (exitCode !== 0) {
      return Result.fail(
        makeError({
          message: `${providerLabel} exited with code ${exitCode}`,
          exitCode,
          ...(stderr ? { stderrExcerpt: excerpt(stderr) } : {}),
        }),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout) as unknown;
    } catch (err) {
      return Result.fail(
        makeError({
          message: `${providerLabel} returned invalid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        }),
      );
    }

    const decoded = decode(parsed);
    if (Result.isFailure(decoded)) {
      return Result.fail(
        makeError({
          message: `${providerLabel} response failed schema validation:\n${formatParseError(
            decoded.left,
          )}`,
        }),
      );
    }

    return Result.succeed(decoded.right);
  });
}
