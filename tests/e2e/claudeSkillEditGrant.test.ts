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

// Tool calls, tool results and permission denials from Claude's stream-json output.
function toolTrace(stdout: string): string {
  const lines: string[] = [];
  for (const raw of stdout.split("\n")) {
    let event: {
      type?: string;
      subtype?: string;
      decision_reason?: string;
      message?: { content?: unknown };
    };
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    if (event.type === "system" && event.subtype === "permission_denied") {
      lines.push(`denied: ${event.decision_reason ?? ""}`);
    }
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of content as {
      type?: string;
      name?: string;
      input?: unknown;
      content?: unknown;
      text?: string;
    }[]) {
      if (block.type === "tool_use") lines.push(`${block.name}: ${JSON.stringify(block.input)}`);
      if (block.type === "tool_result")
        lines.push(`  -> ${JSON.stringify(block.content).slice(0, 300)}`);
      if (block.type === "text") lines.push(`text: ${block.text?.slice(0, 300) ?? ""}`);
    }
  }
  return lines.join("\n");
}

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
      model: "claude-sonnet-5",
      effort: "low",
      cwd: repoDir,
      security,
      skillEditGrants: [FOO, NEW],
    });

    const prompt = [
      "Do exactly these three file operations, one after another, and continue even if one is denied:",
      `1. Use the Edit tool on ${FOO}: replace the exact text "# original" with "# foo edited".`,
      `2. Use the Edit tool on ${BAR}: replace the exact text "# original" with "# bar edited".`,
      `3. Use the Write tool to create ${NEW} with the content "# new skill".`,
      "Do not use any other tools. Then reply DONE.",
    ].join("\n");

    const result = spawnSync("claude", args, {
      cwd: repoDir,
      input: prompt,
      encoding: "utf8",
      timeout: 300_000,
    });
    expect(result.status, result.stderr).toBe(0);

    // On failure, show what the agent attempted and what each call returned, so
    // a model that skipped a step is told apart from a grant that did not apply.
    const trace = toolTrace(result.stdout);
    expect(readFileSync(join(repoDir, FOO), "utf8"), trace).not.toBe(ORIGINAL);
    expect(existsSync(join(repoDir, NEW)), trace).toBe(true);
    expect(readFileSync(join(repoDir, BAR), "utf8"), trace).toBe(ORIGINAL);
    // BAR must be unchanged because the protected-path check denied it, not
    // because the agent never reached a permission decision.
    expect(trace).toContain(
      `denied: Claude requested permissions to write to ${join(repoDir, BAR)}`,
    );
  });
});
