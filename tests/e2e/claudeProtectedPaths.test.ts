import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgs } from "../../src/infra/providers/claudeCode.js";
import { protectedList } from "../../src/domain/security/protectedPaths.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { probeProvider } from "./helpers/providers.js";

// Guards the Claude Code behavior the native protected-path rules rely on: an
// `Edit(//<worktree>/**/steme.baseline.json)` deny rule in the inline
// `--settings` makes a headless acceptEdits session refuse both Write and Edit
// of that file at any depth. Opt-in like realFlow (PHAX_E2E_RUN=1); the review
// runs it by name, the phase gate does not.
const shouldRun = process.env["PHAX_E2E_RUN"] === "1" && probeProvider("claude");

const ORIGINAL = '{"limit": 1}\n';
const PROTECTED = "packages/a/steme.baseline.json";

interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  /** The tool_result's text, once it arrived. */
  result?: string;
  isError?: boolean;
}

// The tool calls of Claude's stream-json output, each with its result.
function toolCalls(stdout: string): ToolCall[] {
  const calls = new Map<string, ToolCall>();
  for (const raw of stdout.split("\n")) {
    let event: { message?: { content?: unknown } };
    try {
      event = JSON.parse(raw);
    } catch {
      continue;
    }
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of content as {
      type?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }[]) {
      if (block.type === "tool_use" && block.id !== undefined) {
        calls.set(block.id, { id: block.id, name: block.name ?? "", input: block.input });
      }
      if (block.type === "tool_result" && block.tool_use_id !== undefined) {
        const call = calls.get(block.tool_use_id);
        if (call !== undefined) {
          call.result =
            typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          call.isError = block.is_error === true;
        }
      }
    }
  }
  return [...calls.values()];
}

describe.skipIf(!shouldRun)("claude-code protected path deny rule (real provider)", () => {
  let repoDir: string;

  beforeAll(() => {
    // realpath: macOS tmpdir is a symlink, and the deny rule must match the
    // path Claude Code resolves.
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-protected-e2e-")));
    spawnSync("git", ["init", "-q"], { cwd: repoDir });
    mkdirSync(join(repoDir, "packages", "a"), { recursive: true });
    writeFileSync(join(repoDir, PROTECTED), ORIGINAL);
  });

  afterAll(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  it("refuses Write and Edit of a protected file at depth and leaves it unchanged", () => {
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
      protectedPaths: protectedList(["**/steme.baseline.json"], "phax.json") ?? undefined,
    });

    const prompt = [
      "Do exactly these two file operations, one after another, and continue even if one is denied:",
      `1. Use the Write tool to overwrite ${PROTECTED} with the content {"limit": 99}.`,
      `2. Use the Edit tool on ${PROTECTED}: replace the exact text "1" with "2".`,
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
    // a model that skipped a step is told apart from a rule that did not apply.
    const calls = toolCalls(result.stdout);
    const trace = calls
      .map((call) => `${call.name}: ${JSON.stringify(call.input)} -> ${call.result ?? "(none)"}`)
      .join("\n");
    expect(readFileSync(join(repoDir, PROTECTED), "utf8"), trace).toBe(ORIGINAL);
    for (const tool of ["Write", "Edit"]) {
      const attempts = calls.filter((call) => call.name === tool);
      expect(attempts.length, `no ${tool} call\n${trace}`).toBeGreaterThan(0);
      for (const attempt of attempts) {
        expect(attempt.isError, `${tool} was not denied\n${trace}`).toBe(true);
        expect(attempt.result, trace).toMatch(/den(y|ied)|permission/i);
      }
    }
  });
});
