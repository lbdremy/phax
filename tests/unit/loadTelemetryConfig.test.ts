import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Result } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTelemetryConfig } from "../../src/app/loadTelemetryConfig.js";
import { resolvePhaxHome } from "../../src/app/phaxHome.js";
import { phaxHomeFile } from "../../src/domain/phaxHome.js";

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

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.enabled).toBe(true);
    }

    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written).toEqual({ enabled: true });
  });

  it("does not overwrite an existing file when scaffolding", () => {
    const custom = JSON.stringify({ enabled: false });
    writeFileSync(configPath, custom);

    const result = loadTelemetryConfig(configPath);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.enabled).toBe(false);
    }
    // file unchanged
    expect(readFileSync(configPath, "utf8")).toBe(custom);
  });

  it("decodes a valid present file", () => {
    writeFileSync(configPath, JSON.stringify({ enabled: false }));

    const result = loadTelemetryConfig(configPath);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.enabled).toBe(false);
    }
  });

  it("returns a ConfigValidationError for an invalid file", () => {
    writeFileSync(configPath, JSON.stringify({ enabled: "yes" }));

    const result = loadTelemetryConfig(configPath);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("Invalid telemetry.json");
    }
  });

  it("returns a ConfigValidationError for a malformed JSON file", () => {
    writeFileSync(configPath, "{ not valid json }");

    const result = loadTelemetryConfig(configPath);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.message).toContain("Failed to read or parse");
    }
  });
});

describe("telemetry.json in the phax home", () => {
  afterEach(() => {
    delete process.env["PHAX_HOME"];
  });

  it("ac-moves: with PHAX_HOME naming a home that does not exist yet, the scaffold creates it there", () => {
    const home = join(tmpDir, "moved-home");
    process.env["PHAX_HOME"] = home;
    const resolved = Result.getOrThrow(resolvePhaxHome());
    expect(resolved).toEqual({ path: home, from: "PHAX_HOME" });

    const result = loadTelemetryConfig(phaxHomeFile(resolved, "telemetry.json"));

    expect(result).toEqual(Result.succeed({ enabled: true }));
    expect(readFileSync(join(home, "telemetry.json"), "utf8")).toBe('{\n  "enabled": true\n}\n');
  });

  it("reads the moved home's file, not another one", () => {
    const home = join(tmpDir, "moved-home");
    mkdirSync(home);
    writeFileSync(join(home, "telemetry.json"), JSON.stringify({ enabled: false }));
    process.env["PHAX_HOME"] = home;

    const result = loadTelemetryConfig(
      phaxHomeFile(Result.getOrThrow(resolvePhaxHome()), "telemetry.json"),
    );

    expect(result).toEqual(Result.succeed({ enabled: false }));
  });
});
