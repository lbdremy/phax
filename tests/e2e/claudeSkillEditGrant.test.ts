import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgs } from "../../src/infra/providers/claudeCode.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { probeProvider } from "./helpers/providers.js";

// Guards the Claude Code behavior the skill edit grant relies on: a
// PermissionRequest hook scoped by an `if` rule lets a headless acceptEdits
// session write exactly the granted `.claude/skills/**` files, while other
// protected-path writes stay denied. Opt-in like realFlow (PHAX_E2E_RUN=1).
const shouldRun = process.env["PHAX_E2E_RUN"] === "1" && probeProvider("claude");

const ORIGINAL = "# original\n";
const FOO = ".claude/skills/foo/SKILL.md";
const BAR = ".claude/skills/bar/SKILL.md";
const NEW = ".claude/skills/new/SKILL.md";

describe.skipIf(!shouldRun)("claude-code skill edit grant (real provider)", () => {
  let repoDir: string;

  beforeAll(() => {
    // realpath: macOS tmpdir is a symlink, and the `if` rule must match the
    // path Claude Code resolves.
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-skill-grant-e2e-")));
    spawnSync("git", ["init", "-q"], { cwd: repoDir });
    for (const file of [FOO, BAR]) {
      mkdirSync(join(repoDir, file, ".."), { recursive: true });
      writeFileSync(join(repoDir, file), ORIGINAL);
    }
  });

  afterAll(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  it("edits and creates granted skill files, and leaves an ungranted sibling unchanged", () => {
    const security: SecurityPolicy = {
      mode: "secure",
      filesystem: { allowRead: [repoDir], allowWrite: [repoDir] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: [],
      failClosed: true,
    };
    const args = buildArgs({
      provider: "claude-code",
      model: "claude-haiku-4-5-20251001",
      effort: "low",
      cwd: repoDir,
      security,
      skillEditGrants: [FOO, NEW],
    });

    const prompt = [
      "Do exactly these three file operations, one after another, and continue even if one is denied:",
      `1. Edit ${FOO}: replace its content with "# foo edited".`,
      `2. Edit ${BAR}: replace its content with "# bar edited".`,
      `3. Create ${NEW} with the content "# new skill".`,
      "Do not use any other tools. Then reply DONE.",
    ].join("\n");

    const result = spawnSync("claude", args, {
      cwd: repoDir,
      input: prompt,
      encoding: "utf8",
      timeout: 300_000,
    });
    expect(result.status, result.stderr).toBe(0);

    expect(readFileSync(join(repoDir, FOO), "utf8")).not.toBe(ORIGINAL);
    expect(existsSync(join(repoDir, NEW))).toBe(true);
    expect(readFileSync(join(repoDir, BAR), "utf8")).toBe(ORIGINAL);
  });
});
