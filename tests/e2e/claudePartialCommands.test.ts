import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Result } from "effect";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgs } from "../../src/infra/providers/claudeCode.js";
import { projectOnlyEnvironment } from "../../src/domain/session/claudeProjectOnly.js";
import { parsePartialCommand } from "../../src/domain/gate/partialCommand.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import { probeProvider } from "./helpers/providers.js";

// ac-claude-real: guards the probe fact behind partial commands. Under phax's
// secure Claude Code flags, one `Bash(<prefix>:*)` rule per pipe segment lets a
// piped diff command run; a pipe into a command no rule allows is denied though
// its first segment is allowed; and a nested `$(…)` form is denied though its
// outer and inner leading words are both allowed. The diff
// command is a tool-free stand-in for a project's `pnpm exec oxlint …` pipe
// (that tool does not exist in a temporary repository). Opt-in like realFlow
// (PHAX_E2E_RUN=1); the operator runs it by name, the phase gate does not.
const shouldRun = process.env["PHAX_E2E_RUN"] === "1" && probeProvider("claude");

const DIFF_COMMAND = "git diff --name-only --diff-filter=d | xargs wc -l";
// Both the outer and the inner command start with an allowed prefix, so a
// denial can come only from the substitution itself.
const NESTED_COMMAND =
  "git diff --name-only --diff-filter=d $(git diff --name-only --diff-filter=d)";
// The first segment is allowed, `tee` is not: if this ran, Claude Code matched
// the call's start only, and the canary file would exist.
const CANARY = "pipe-canary.txt";
const UNLISTED_PIPE_COMMAND = `git diff --name-only --diff-filter=d | tee ${CANARY}`;
const TRACKED = "tracked.txt";

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

const commandOf = (call: ToolCall): string =>
  String((call.input as { command?: unknown } | null)?.command ?? "");

function git(cwd: string, args: readonly string[]): void {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  expect(r.status, `git ${args.join(" ")}: ${r.stderr}`).toBe(0);
}

describe.skipIf(!shouldRun)("ac-claude-real: claude-code piped partial command", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-partial-e2e-")));
    git(repoDir, ["init", "-q"]);
    git(repoDir, ["config", "user.email", "e2e@example.com"]);
    git(repoDir, ["config", "user.name", "e2e"]);
    writeFileSync(join(repoDir, TRACKED), "one\n");
    git(repoDir, ["add", TRACKED]);
    git(repoDir, ["commit", "-q", "-m", "init"]);
    // Modified and left uncommitted: three lines, so wc -l reports 3.
    writeFileSync(join(repoDir, TRACKED), "one\ntwo\nthree\n");
  });

  afterAll(() => {
    if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  });

  it("runs the piped diff command, denies a pipe into an unlisted command and the nested $(…) form", () => {
    const parsed = parsePartialCommand(DIFF_COMMAND, "diff");
    if (Result.isFailure(parsed))
      throw new Error(`the diff command was refused: ${parsed.left.kind}`);
    const prefixes = parsed.right.segments.map((segment) => segment.prefix);
    expect(prefixes).toEqual(["git diff --name-only --diff-filter=d", "xargs wc -l"]);

    const security: SecurityPolicy = {
      mode: "secure",
      filesystem: { allowRead: [repoDir], allowWrite: [repoDir] },
      network: { profile: "provider-only" },
      mcp: { mode: "disabled", allow: [] },
      agentCommands: prefixes,
      failClosed: true,
    };
    const args = buildArgs({
      provider: "claude-code",
      model: "claude-sonnet-5",
      effort: "low",
      cwd: repoDir,
      security,
      agentCommands: prefixes,
    });

    // The launch under test carries one rule per pipe segment.
    const argv = args.join(" ");
    expect(argv).toContain("Bash(git diff --name-only --diff-filter=d:*)");
    expect(argv).toContain("Bash(xargs wc -l:*)");

    const prompt = [
      "Make exactly these three Bash calls, one after another, and continue even if one is denied:",
      `1. Run this command verbatim: ${DIFF_COMMAND}`,
      `2. Run this command verbatim: ${NESTED_COMMAND}`,
      `3. Run this command verbatim: ${UNLISTED_PIPE_COMMAND}`,
      "Make no other tool call. Then reply DONE.",
    ].join("\n");

    const result = spawnSync("claude", args, {
      cwd: repoDir,
      input: prompt,
      encoding: "utf8",
      timeout: 300_000,
      env: projectOnlyEnvironment(process.env),
    });
    expect(result.status, result.stderr).toBe(0);

    const calls = toolCalls(result.stdout);
    const trace = calls
      .map(
        (call) =>
          `${call.name}: ${JSON.stringify(call.input)} -> ${call.isError === true ? "ERROR " : ""}${call.result ?? "(none)"}`,
      )
      .join("\n");

    const bash = calls.filter((call) => call.name === "Bash");
    const piped = bash.find((call) => commandOf(call).includes("xargs wc -l"));
    const nested = bash.find((call) => commandOf(call).includes("$("));
    const unlisted = bash.find((call) => commandOf(call).includes(`tee ${CANARY}`));
    expect(piped, `no piped diff call\n${trace}`).toBeDefined();
    expect(nested, `no nested call\n${trace}`).toBeDefined();
    expect(unlisted, `no call piping into an unlisted command\n${trace}`).toBeDefined();

    expect(piped?.isError, `the piped command did not run\n${trace}`).toBe(false);
    expect(piped?.result, `the result lacks the file's line count\n${trace}`).toMatch(
      new RegExp(`\\b3\\b[^\\n]*${TRACKED}`),
    );

    expect(nested?.isError, `the nested command was not denied\n${trace}`).toBe(true);
    expect(nested?.result, trace).toMatch(/den(y|ied)|permission|not allowed|nested|substitution/i);

    expect(unlisted?.isError, `the pipe into tee was not denied\n${trace}`).toBe(true);
    expect(unlisted?.result, trace).toMatch(/den(y|ied)|permission|not allowed|requires approval/i);
    expect(existsSync(join(repoDir, CANARY)), `tee ran: ${CANARY} exists\n${trace}`).toBe(false);
  });
});
