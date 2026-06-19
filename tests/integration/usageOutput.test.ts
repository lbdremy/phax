import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const mainTs = join(repoRoot, "src/cli/main.ts");
const specPath = join(repoRoot, "phax.usage.kdl");

function runCli(args: string[]): ReturnType<typeof spawnSync> {
  return spawnSync("tsx", [mainTs, ...args], {
    encoding: "utf8",
    env: { ...process.env },
  });
}

describe("phax --usage", () => {
  it("prints the KDL spec to stdout and exits 0", () => {
    const result = runCli(["--usage"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    // KDL spec starts with the generated file comment and then 'name "phax"'
    expect(result.stdout).toContain('name "phax"');
    expect(result.stdout).toContain('bin "phax"');
  });

  it("KDL output matches the committed phax.usage.kdl byte-for-byte", () => {
    const result = runCli(["--usage"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    const committed = readFileSync(specPath, "utf8");
    expect(result.stdout).toBe(committed);
  });

  it("--usage-format kdl is equivalent to the default", () => {
    const defaultResult = runCli(["--usage"]);
    const explicitResult = runCli(["--usage", "--usage-format", "kdl"]);
    expect(defaultResult.status).toBe(0);
    expect(explicitResult.status).toBe(0);
    expect(explicitResult.stdout).toBe(defaultResult.stdout);
  });

  it("--usage-format json produces JSON output when usage CLI is available", () => {
    const checkUsage = spawnSync("usage", ["--version"], { encoding: "utf8" });
    if (checkUsage.error !== undefined || checkUsage.status !== 0) {
      // usage CLI not available — skip
      return;
    }

    const result = runCli(["--usage", "--usage-format", "json"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("name");
  });

  it("--usage-format with invalid value exits non-zero with an actionable error", () => {
    const result = runCli(["--usage", "--usage-format", "toml"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("invalid --usage-format value");
    expect(result.stderr).toContain("kdl");
    expect(result.stderr).toContain("json");
  });

  it("works when passed before a subcommand (preAction hook intercepts)", () => {
    // --usage before `validate` should print spec, not run validate
    const result = runCli(["--usage", "validate"]);
    expect(result.status, `stderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('name "phax"');
  });
});

describe("phax --version vs KDL version", () => {
  it("--version matches the version field in phax.usage.kdl", () => {
    const versionResult = runCli(["--version"]);
    expect(versionResult.status).toBe(0);
    const cliVersion = versionResult.stdout.trim();

    expect(existsSync(specPath)).toBe(true);
    const kdlContent = readFileSync(specPath, "utf8");
    const versionMatch = /^version\s+"([^"]+)"/m.exec(kdlContent);
    expect(versionMatch, "could not find version field in phax.usage.kdl").not.toBeNull();
    const kdlVersion = versionMatch![1];

    expect(cliVersion).toBe(kdlVersion);
  });
});
