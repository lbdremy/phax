import { decideProtectedPathApproval } from "../../domain/security/protectedPaths.js";
import {
  parseClaudeHookPayload,
  PHAX_APPROVED_PATHS_ENV,
} from "../../schemas/claudeHookPayload.js";

const ALLOW_OUTPUT = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
  },
});

function readApprovedPaths(): readonly string[] {
  const raw = process.env[PHAX_APPROVED_PATHS_ENV];
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
    return [];
  } catch {
    return [];
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

/**
 * Thin CLI entry point for the Claude Code PreToolUse hook.
 *
 * Reads the hook payload from stdin, decodes it, and calls the domain
 * decision with the approved paths from the PHAX_APPROVED_PATHS env var.
 * On "allow" prints the Claude permissionDecision JSON; on "defer" prints
 * nothing and exits 0 so Claude's normal protected-path handling applies.
 *
 * Contains no business logic — all decisions are in decideProtectedPathApproval.
 */
export async function runApproveProtectedPath(): Promise<number> {
  const approvedAbsolutePaths = readApprovedPaths();
  const stdinText = await readStdin();
  const payload = parseClaudeHookPayload(stdinText.trim());

  if (payload === undefined) {
    // Unrecognized payload — defer to Claude's default handling.
    return 0;
  }

  const decision = decideProtectedPathApproval({
    approvedAbsolutePaths,
    toolName: payload.tool_name,
    filePath: payload.tool_input.file_path,
  });

  if (decision === "allow") {
    process.stdout.write(ALLOW_OUTPUT + "\n");
  }

  return 0;
}
