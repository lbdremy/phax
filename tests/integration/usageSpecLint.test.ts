import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const specPath = join(repoRoot, "phax.usage.kdl");

describe("phax.usage.kdl", () => {
  it("spec file exists at the repo root", () => {
    expect(existsSync(specPath), `phax.usage.kdl not found at ${specPath}`).toBe(true);
  });

  it("lints clean with the usage CLI (warnings treated as errors)", () => {
    const result = spawnSync("usage", ["lint", "-W", specPath], {
      encoding: "utf8",
      env: { ...process.env },
    });

    if (result.error !== undefined) {
      const isNotFound =
        (result.error as NodeJS.ErrnoException).code === "ENOENT" ||
        result.error.message.includes("ENOENT");
      if (isNotFound) {
        throw new Error(
          "The `usage` CLI is required but was not found on PATH.\n" +
            "Install it with: brew install jdx/tap/usage\n" +
            "See https://usage.jdx.dev/cli/ for other install options.",
        );
      }
      throw result.error;
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

    expect(result.status, `usage lint failed (exit ${result.status}):\n${output}`).toBe(0);

    // Belt-and-suspenders: also check for warning lines in the text output.
    // -W already makes the exit code non-zero on warnings, but this gives a
    // clearer failure message if a future usage CLI version changes that behaviour.
    const hasWarnLines = /^warn\b/m.test(output);
    expect(hasWarnLines, `usage lint reported warnings (treated as errors):\n${output}`).toBe(
      false,
    );
  });
});
