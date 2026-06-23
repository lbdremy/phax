import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const specPath = join(repoRoot, "phax.usage.kdl");

// The one expected info: `usage lint` flags the root `cmd phax` as having no
// `help` node because the program description is emitted as the KDL `about`
// field instead. See the carve-out comment in the lint test below.
const isRootHelpInfo = (line: string): boolean =>
  line.includes("[missing-cmd-help]") && line.includes("cmd phax");

describe("phax.usage.kdl", () => {
  it("spec file exists at the repo root", () => {
    expect(existsSync(specPath), `phax.usage.kdl not found at ${specPath}`).toBe(true);
  });

  it("lints clean with the usage CLI (warnings and infos treated as errors)", () => {
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
            "Install it with: brew install usage\n" +
            "See https://usage.jdx.dev/cli/ for other install options.",
        );
      }
      throw result.error;
    }

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

    expect(result.status, `usage lint failed (exit ${result.status}):\n${output}`).toBe(0);

    // Belt-and-suspenders: also check for warning/info lines in the text output.
    // -W already makes the exit code non-zero on warnings, but this gives a
    // clearer failure message if a future usage CLI version changes that behaviour.
    // Infos are treated as errors here because every command and argument must
    // carry help text; a missing-*-help info means metadata was omitted.
    //
    // One permanent exception: the root `cmd phax` carries no top-level `help`
    // node — Commander's program description is emitted as the KDL `about`
    // field (the correct place for a binary description), not as `help` inside
    // a `cmd phax { }` block — so `usage lint` reports exactly one
    // `missing-cmd-help` info for it. All other infos (a new argument or
    // command without help) are failures.
    const hasWarnLines = /^warn\b/m.test(output);
    expect(hasWarnLines, `usage lint reported warnings (treated as errors):\n${output}`).toBe(
      false,
    );
    const infoLines = output.match(/^info\b.*/gm) ?? [];
    const unexpectedInfos = infoLines.filter((line) => !isRootHelpInfo(line));
    expect(
      unexpectedInfos,
      `usage lint reported unexpected infos (treated as errors):\n${unexpectedInfos.join("\n")}`,
    ).toEqual([]);

    // The carve-out polices itself: assert the exempted info is present exactly
    // once. If a future `usage` version stops reporting `missing-cmd-help` for
    // the root `cmd phax` (or reports it more than once), this fails and tells
    // us to delete or revisit the exemption above rather than silently passing.
    const rootHelpInfos = infoLines.filter(isRootHelpInfo);
    expect(
      rootHelpInfos.length,
      "Expected exactly one carved-out `missing-cmd-help` info for the root `cmd phax`. " +
        "If the installed `usage` CLI no longer emits it, this exemption is obsolete — " +
        `remove it from this test. Saw infos:\n${infoLines.join("\n")}`,
    ).toBe(1);
  });
});
