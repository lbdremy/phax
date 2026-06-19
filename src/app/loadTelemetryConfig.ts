import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Either } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import { decodeTelemetryConfig, type TelemetryConfig } from "../schemas/telemetryConfig.js";
import { formatParseError } from "../schemas/formatError.js";

export const TELEMETRY_CONFIG_PATH = join(homedir(), ".phax", "telemetry.json");

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = { enabled: true };
const DEFAULT_TELEMETRY_CONFIG_JSON = JSON.stringify(DEFAULT_TELEMETRY_CONFIG, null, 2) + "\n";

export type LoadTelemetryConfigError = ConfigValidationError;

export function loadTelemetryConfig(
  configPath: string = TELEMETRY_CONFIG_PATH,
): Either.Either<TelemetryConfig, LoadTelemetryConfigError> {
  if (!existsSync(configPath)) {
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      // "wx" flag: write-only exclusive — fails silently if file was created concurrently
      writeFileSync(configPath, DEFAULT_TELEMETRY_CONFIG_JSON, { flag: "wx" });
    } catch {
      // swallow: another process may have scaffolded the file between existsSync and writeFileSync
    }
    return Either.right(DEFAULT_TELEMETRY_CONFIG);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    return Either.left(
      new ConfigValidationError({
        message: `Failed to read or parse "${configPath}": ${String(err)}`,
        path: configPath,
      }),
    );
  }

  const decoded = decodeTelemetryConfig(raw);
  if (Either.isLeft(decoded)) {
    return Either.left(
      new ConfigValidationError({
        message: `Invalid telemetry.json at "${configPath}":\n${formatParseError(decoded.left)}`,
        path: configPath,
      }),
    );
  }

  return Either.right(decoded.right);
}
