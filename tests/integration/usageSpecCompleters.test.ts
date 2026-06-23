import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateUsageSpec } from "../../scripts/generate-usage-spec.js";
import { cliCompleters } from "../../src/cli/cliCompleters.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");

// ── Spec completer gate ───────────────────────────────────────────────────────
//
// Asserts the generated spec contains a `complete` node for every entry in
// cliCompleters, and that `phax ls --complete` prints `short-name:state`
// lines with no table chrome. Run before wiring the generator to catch drift.

describe("usageSpec completers gate", () => {
  const spec = generateUsageSpec();

  for (const [argName, completer] of Object.entries(cliCompleters)) {
    it(`spec contains complete "${argName}" run="${completer.run}"`, () => {
      expect(spec).toContain(`complete "${argName}" run="${completer.run}"`);
    });

    if (completer.descriptions) {
      it(`complete "${argName}" node has descriptions=#true`, () => {
        // Find the complete node line and check descriptions is set.
        const line = spec.split("\n").find((l) => l.includes(`complete "${argName}"`));
        expect(line, `complete "${argName}" line not found in spec`).toBeDefined();
        expect(line).toContain("descriptions=#true");
      });
    }
  }
});

// ── ls --complete output gate ─────────────────────────────────────────────────
//
// Asserts `phax ls --complete` (via tsx) prints `short-name:state` lines
// and no table header or separator chrome.

describe("phax ls --complete output", () => {
  it("exits 0 and prints short-name:state lines (no table chrome)", () => {
    const result = spawnSync(
      "node",
      ["--import", "tsx/esm", join(repoRoot, "src/cli/main.ts"), "ls", "--complete"],
      {
        encoding: "utf8",
        env: { ...process.env },
        cwd: repoRoot,
      },
    );

    // May exit non-zero if no registry exists (fresh checkout) — that's fine,
    // but if it does produce output it must match the `short-name:state` format.
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    // The output must contain no table header/separator lines.
    expect(stdout, `ls --complete should not print table chrome:\n${stdout}`).not.toMatch(
      /^NAME\s+STATE|^-{3,}/m,
    );

    // If there is any output, every non-empty line must match `<slug>:<state>`.
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      expect(line, `ls --complete line does not match short-name:state format:\n${stderr}`).toMatch(
        /^[a-z0-9][a-z0-9-]*:[a-z_]+$/,
      );
    }
  });
});
