import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/commands/init.js";

const captureOutput = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    out: {
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
    },
    logs,
    errors,
  };
};

const PKG_WITH_SCRIPTS = JSON.stringify({
  name: "@org/my-app",
  packageManager: "pnpm@9.0.0",
  scripts: {
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    "test:unit": "vitest run unit",
  },
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "phax-init-cmd-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("runInit --yes (non-interactive)", () => {
  it("creates phax.json, phax.schema.json, and phax.user.schema.json from package.json", async () => {
    await writeFile(join(tmpDir, "package.json"), PKG_WITH_SCRIPTS, "utf8");

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { out, logs, errors } = captureOutput();
      const code = await runInit({ yes: true }, out);

      expect(code).toBe(0);
      expect(errors).toHaveLength(0);
      expect(logs.some((l) => l.includes("phax.json"))).toBe(true);

      const configText = await readFile(join(tmpDir, "phax.json"), "utf8");
      const config = JSON.parse(configText) as Record<string, unknown>;

      expect(config["name"]).toBe("my-app");
      expect(config).not.toHaveProperty("state");
      expect(config).not.toHaveProperty("project");
      expect(config["version"]).toBe(1);
      expect(config["$schema"]).toBe("./phax.schema.json");

      const gateProfiles = config["gateProfiles"] as Record<string, unknown>;
      const fastCommands = gateProfiles["fast"] as string[];
      expect(fastCommands.some((c) => c.includes("typecheck"))).toBe(true);
      expect(fastCommands.some((c) => c.includes("lint"))).toBe(true);
      expect(fastCommands.some((c) => c.includes("test:unit"))).toBe(true);

      await readFile(join(tmpDir, "phax.schema.json"), "utf8");
      await readFile(join(tmpDir, "phax.user.schema.json"), "utf8");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("falls back to slugified directory basename when package.json is absent", async () => {
    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { out } = captureOutput();
      const code = await runInit({ yes: true }, out);

      expect(code).toBe(0);
      const configText = await readFile(join(tmpDir, "phax.json"), "utf8");
      const config = JSON.parse(configText) as Record<string, unknown>;
      expect(typeof config["name"]).toBe("string");
      expect(config["name"]).toMatch(/^[a-z][a-z0-9-]*$/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("returns 1 and prints error when already initialized (no --force)", async () => {
    await writeFile(
      join(tmpDir, "phax.json"),
      JSON.stringify({ version: 1, name: "existing", gateProfiles: { fast: ["echo ok"] } }),
      "utf8",
    );

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { out, errors } = captureOutput();
      const code = await runInit({ yes: true }, out);

      expect(code).toBe(1);
      expect(errors.some((e) => e.includes("already initialized"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("overwrites existing phax.json with --force", async () => {
    await writeFile(
      join(tmpDir, "phax.json"),
      JSON.stringify({ version: 1, name: "old", gateProfiles: { fast: ["echo old"] } }),
      "utf8",
    );
    await writeFile(join(tmpDir, "package.json"), PKG_WITH_SCRIPTS, "utf8");

    const originalCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { out, errors } = captureOutput();
      const code = await runInit({ force: true, yes: true }, out);

      expect(code).toBe(0);
      expect(errors).toHaveLength(0);
      const configText = await readFile(join(tmpDir, "phax.json"), "utf8");
      const config = JSON.parse(configText) as Record<string, unknown>;
      expect(config["name"]).toBe("my-app");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
