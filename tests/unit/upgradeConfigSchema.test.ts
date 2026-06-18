import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { upgradeConfigSchema } from "../../src/app/initProject.js";

let repoDir: string;

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "phax-schema-upgrade-test-"));
  execSync("git init", { cwd: repoDir, stdio: "ignore" });
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("upgradeConfigSchema", () => {
  it("returns no_config when there is no phax.json", () => {
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("no_config");
  });

  it("returns updated and writes phax.schema.json when phax.json exists but no schema", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.schemaPath).toBe(join(repoDir, "phax.schema.json"));
    }
    const written = readFileSync(join(repoDir, "phax.schema.json"), "utf8");
    expect(written.length).toBeGreaterThan(0);
  });

  it("returns current on a second call when schema is already up to date", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    upgradeConfigSchema(repoDir);
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("current");
  });

  it("returns updated after the schema file is mutated", () => {
    writeFileSync(join(repoDir, "phax.json"), JSON.stringify({ version: 1 }));
    upgradeConfigSchema(repoDir);
    writeFileSync(join(repoDir, "phax.schema.json"), "stale content");
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
  });

  it("writes the schema even when phax.json contains invalid JSON", () => {
    writeFileSync(join(repoDir, "phax.json"), "not valid json {{");
    const result = upgradeConfigSchema(repoDir);
    expect(result.kind).toBe("updated");
    const written = readFileSync(join(repoDir, "phax.schema.json"), "utf8");
    expect(written.length).toBeGreaterThan(0);
  });
});
