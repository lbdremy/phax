import { Either, type ParseResult, Schema } from "effect";
import { formatFirstViolation } from "./formatError.js";

const TokenCountSchema = Schema.Number.pipe(Schema.finite(), Schema.nonNegative());

const VibeUsageSchema = Schema.Struct({
  input_tokens: TokenCountSchema,
  output_tokens: TokenCountSchema,
  cached_input_tokens: TokenCountSchema,
  total_tokens: TokenCountSchema,
});

/**
 * The `export.json` Vibe 3 writes into a headless turn's `--output-dir`
 * (`schema_version` 1): the turn's session id, its usage and cost, and how it
 * ended, and the config it ran with. The usage and the cost count that turn
 * only. `config` is read as is: the adapter compares the values phax set
 * (`vibeConfigMismatch`), and Vibe writes it null when it never loaded one.
 * Keys phax does not read (`limits`, `steps`, `journal_dir`, timestamps and
 * whatever Vibe adds later) are accepted and dropped.
 */
const VibeExportSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  session_id: Schema.NonEmptyString,
  usage: VibeUsageSchema,
  cost_usd: Schema.Number.pipe(Schema.finite()),
  outcome: Schema.String,
  exit_code: Schema.Number,
  vibe_version: Schema.String,
  config: Schema.optional(Schema.Unknown),
});

export type VibeExport = Schema.Schema.Type<typeof VibeExportSchema>;

/**
 * The same document as the session outcome reader takes it. A turn that failed
 * early writes `session_id`, `usage`, `cost_usd` and `config` as null, and
 * adds an `error` (`null` or `{message, code}`) saying why. Every export the
 * schema above accepts is accepted here too.
 */
const VibeOutcomeExportSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  session_id: Schema.NullOr(Schema.NonEmptyString),
  usage: Schema.NullOr(VibeUsageSchema),
  cost_usd: Schema.NullOr(Schema.Number.pipe(Schema.finite())),
  outcome: Schema.String,
  exit_code: Schema.Number,
  error: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        message: Schema.String,
        code: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
  vibe_version: Schema.String,
  config: Schema.optional(Schema.Unknown),
});

export type VibeOutcomeExport = Schema.Schema.Type<typeof VibeOutcomeExportSchema>;

/** Why export text was refused: not JSON at all, or JSON that is not a version-1 export. */
interface VibeExportRefusal {
  readonly reason: "not-json" | "not-an-export";
  readonly detail: string;
}

const decodeVibeExport = Schema.decodeUnknownEither(VibeExportSchema);
const decodeVibeOutcomeExport = Schema.decodeUnknownEither(VibeOutcomeExportSchema);

function decodeExportText<A>(
  decode: (input: unknown) => Either.Either<A, ParseResult.ParseError>,
  text: string,
): Either.Either<A, VibeExportRefusal> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return Either.left({
      reason: "not-json",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const decoded = decode(parsed);
  if (Either.isLeft(decoded)) {
    return Either.left({ reason: "not-an-export", detail: formatFirstViolation(decoded.left) });
  }
  return Either.right(decoded.right);
}

/** Reads an `export.json`'s text. Never throws: a refusal names what was wrong. */
export function decodeVibeExportText(text: string): Either.Either<VibeExport, VibeExportRefusal> {
  return decodeExportText(decodeVibeExport, text);
}

/**
 * Reads an `export.json`'s text for the session outcome, a failed turn's
 * included. Never throws: a refusal names what was wrong.
 */
export function decodeVibeOutcomeText(
  text: string,
): Either.Either<VibeOutcomeExport, VibeExportRefusal> {
  return decodeExportText(decodeVibeOutcomeExport, text);
}
