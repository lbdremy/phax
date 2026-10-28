import { Either, Schema } from "effect";
import { formatFirstViolation } from "./formatError.js";

const TokenCountSchema = Schema.Number.pipe(Schema.finite(), Schema.nonNegative());

/**
 * The `export.json` Vibe 3 writes into a headless turn's `--output-dir`
 * (`schema_version` 1): the turn's session id, its usage and cost, and how it
 * ended. The usage and the cost count that turn only. Keys phax does not read
 * (`limits`, `config`, `steps`, `journal_dir`, timestamps and whatever Vibe
 * adds later) are accepted and dropped.
 */
const VibeExportSchema = Schema.Struct({
  schema_version: Schema.Literal(1),
  session_id: Schema.NonEmptyString,
  usage: Schema.Struct({
    input_tokens: TokenCountSchema,
    output_tokens: TokenCountSchema,
    cached_input_tokens: TokenCountSchema,
    total_tokens: TokenCountSchema,
  }),
  cost_usd: Schema.Number.pipe(Schema.finite()),
  outcome: Schema.String,
  exit_code: Schema.Number,
  vibe_version: Schema.String,
});

export type VibeExport = Schema.Schema.Type<typeof VibeExportSchema>;

/** Why export text was refused: not JSON at all, or JSON that is not a version-1 export. */
interface VibeExportRefusal {
  readonly reason: "not-json" | "not-an-export";
  readonly detail: string;
}

const decodeVibeExport = Schema.decodeUnknownEither(VibeExportSchema);

/** Reads an `export.json`'s text. Never throws: a refusal names what was wrong. */
export function decodeVibeExportText(text: string): Either.Either<VibeExport, VibeExportRefusal> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return Either.left({
      reason: "not-json",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const decoded = decodeVibeExport(parsed);
  if (Either.isLeft(decoded)) {
    return Either.left({ reason: "not-an-export", detail: formatFirstViolation(decoded.left) });
  }
  return Either.right(decoded.right);
}
