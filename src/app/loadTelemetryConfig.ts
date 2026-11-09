import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Result } from "effect";
import { ConfigValidationError } from "../domain/errors.js";
import { decodeTelemetryConfig, type TelemetryConfig } from "../schemas/telemetryConfig.js";
import { formatParseError } from "../schemas/formatError.js";

export const PHAX_HOME_DIR = join(homedir(), ".phax");
export const TELEMETRY_CONFIG_PATH = join(PHAX_HOME_DIR, "telemetry.json");

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = { enabled: true };
const DEFAULT_TELEMETRY_CONFIG_JSON = JSON.stringify(DEFAULT_TELEMETRY_CONFIG, null, 2) + "\n";

export type LoadTelemetryConfigError = ConfigValidationError;

export function loadTelemetryConfig(
  configPath: string = TELEMETRY_CONFIG_PATH,
): Result.Result<TelemetryConfig, LoadTelemetryConfigError> {
  if (!existsSync(configPath)) {
    try {
      mkdirSync(dirname(configPath), { recursive: true });
      // "wx" flag: write-only exclusive — fails silently if file was created concurrently
      writeFileSync(configPath, DEFAULT_TELEMETRY_CONFIG_JSON, { flag: "wx" });
    } catch {
      // swallow: another process may have scaffolded the file between existsSync and writeFileSync
    }
    return Result.succeed(DEFAULT_TELEMETRY_CONFIG);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    return Result.fail(
      new ConfigValidationError({
        message: `Failed to read or parse "${configPath}": ${String(err)}`,
        path: configPath,
      }),
    );
  }

  const decoded = decodeTelemetryConfig(raw);
  if (Result.isFailure(decoded)) {
    return Result.fail(
      new ConfigValidationError({
        message: `Invalid telemetry.json at "${configPath}":\n${formatParseError(decoded.failure)}`,
        path: configPath,
      }),
    );
  }

  return Result.succeed(decoded.success);
}
