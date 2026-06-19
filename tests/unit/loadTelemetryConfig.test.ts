import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTelemetryConfig } from "../../src/app/loadTelemetryConfig.js";

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "phax-telemetry-config-test-"));
  configPath = join(tmpDir, "telemetry.json");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadTelemetryConfig", () => {
  it("returns enabled:true and scaffolds the file when absent", () => {
    expect(existsSync(configPath)).toBe(false);

    const result = loadTelemetryConfig(configPath);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.enabled).toBe(true);
    }

    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written).toEqual({ enabled: true });
  });

  it("does not overwrite an existing file when scaffolding", () => {
    const custom = JSON.stringify({ enabled: false });
    writeFileSync(configPath, custom);

    const result = loadTelemetryConfig(configPath);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.enabled).toBe(false);
    }
    // file unchanged
    expect(readFileSync(configPath, "utf8")).toBe(custom);
  });

  it("decodes a valid present file", () => {
    writeFileSync(configPath, JSON.stringify({ enabled: false }));

    const result = loadTelemetryConfig(configPath);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.enabled).toBe(false);
    }
  });

  it("returns a ConfigValidationError for an invalid file", () => {
    writeFileSync(configPath, JSON.stringify({ enabled: "yes" }));

    const result = loadTelemetryConfig(configPath);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("Invalid telemetry.json");
    }
  });

  it("returns a ConfigValidationError for a malformed JSON file", () => {
    writeFileSync(configPath, "{ not valid json }");

    const result = loadTelemetryConfig(configPath);

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain("Failed to read or parse");
    }
  });
});
