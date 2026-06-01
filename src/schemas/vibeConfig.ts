import { Either, Schema } from "effect";
import { formatParseError } from "./formatError.js";

export const VibeBaseModelSchema = Schema.Struct({
  name: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  temperature: Schema.Number,
  input_price: Schema.Number,
  output_price: Schema.Number,
  auto_compact_threshold: Schema.Number,
});

export type VibeBaseModel = Schema.Schema.Type<typeof VibeBaseModelSchema>;

const decodeVibeBaseModel = Schema.decodeUnknownEither(VibeBaseModelSchema);

export const PHAX_ALIAS_LEVELS = ["off", "low", "medium", "high", "max"] as const;
export type PhaxAliasLevel = (typeof PHAX_ALIAS_LEVELS)[number];

export const PHAX_ALIAS_PREFIX = "phax-mistral-medium-3.5";

export function makePhaxAliasName(level: PhaxAliasLevel): string {
  return `${PHAX_ALIAS_PREFIX}-${level}`;
}

function parseTomlScalar(raw: string): string | number | boolean | undefined {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  if (t === "true") return true;
  if (t === "false") return false;
  const n = Number(t);
  if (!Number.isNaN(n) && t.length > 0) return n;
  return undefined;
}

function extractBlockFields(lines: string[]): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const valueStr = trimmed.slice(eqIdx + 1).trim();
    const value = parseTomlScalar(valueStr);
    if (value !== undefined && key) {
      result[key] = value;
    }
  }
  return result;
}

export function extractBaseModel(
  tomlText: string,
  baseAlias: string,
): Either.Either<VibeBaseModel, string> {
  const lines = tomlText.split("\n");
  const blockStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "[[models]]") blockStarts.push(i);
  }

  for (let b = 0; b < blockStarts.length; b++) {
    const start = blockStarts[b]! + 1;
    const end = b + 1 < blockStarts.length ? blockStarts[b + 1]! : lines.length;
    const blockLines = lines.slice(start, end);

    const hasAlias = blockLines.some((line) => {
      const eqIdx = line.indexOf("=");
      if (eqIdx < 0) return false;
      const key = line.slice(0, eqIdx).trim();
      const valueRaw = line.slice(eqIdx + 1).trim();
      return key === "alias" && parseTomlScalar(valueRaw) === baseAlias;
    });

    if (!hasAlias) continue;

    const fields = extractBlockFields(blockLines);
    const decoded = decodeVibeBaseModel(fields);
    if (Either.isLeft(decoded)) {
      return Either.left(
        `Invalid base model block for alias "${baseAlias}": ${formatParseError(decoded.left)}`,
      );
    }
    return Either.right(decoded.right);
  }

  return Either.left(`Base model block with alias "${baseAlias}" not found in config`);
}

export function renderPhaxAliasBlocks(
  base: VibeBaseModel,
  levels: readonly PhaxAliasLevel[],
): string {
  return levels
    .map(
      (level) =>
        `# Added by PHAX.\n[[models]]\nalias = "${makePhaxAliasName(level)}"\nname = "${base.name}"\nprovider = "${base.provider}"\ntemperature = ${base.temperature}\nthinking = "${level}"\ninput_price = ${base.input_price}\noutput_price = ${base.output_price}\nauto_compact_threshold = ${base.auto_compact_threshold}\n`,
    )
    .join("\n");
}
