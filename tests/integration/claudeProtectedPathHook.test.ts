import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { buildArgs, writeProtectedPathSettings } from "../../src/infra/providers/claudeCode.js";
import {
  buildProtectedPathHookSettings,
  PHAX_APPROVED_PATHS_ENV,
} from "../../src/infra/providers/protectedPathHookSettings.js";
import { decideProtectedPathApproval } from "../../src/domain/security/protectedPaths.js";
import { parseClaudeHookPayload } from "../../src/schemas/claudeHookPayload.js";
import type { AgentRunOptions } from "../../src/ports/backend.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: ["/tmp/work"],
    allowWrite: ["/tmp/work"],
    allowWriteProtected: [".claude/skills/"],
  },
  network: { profile: "provider-only", allowDomains: ["api.anthropic.com"] },
  mcp: { mode: "disabled", allow: [] },
  failClosed: true,
};

const baseOptions = (security: SecurityPolicy): AgentRunOptions => ({
  provider: "claude-code",
  model: "claude-sonnet-4-6",
  effort: "high",
  cwd: "/tmp/work",
  security,
  approvedProtectedPaths: [],
});

// ── Settings builder ──────────────────────────────────────────────────────────

describe("buildProtectedPathHookSettings", () => {
  it("produces a PreToolUse entry with Edit|Write|MultiEdit matcher", () => {
    const settings = buildProtectedPathHookSettings(
      ["/abs/work/.claude/skills/my-skill/SKILL.md"],
      "phax __approve-protected-path",
    );
    expect(settings.hooks.PreToolUse).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0]!.matcher).toBe("Edit|Write|MultiEdit");
    expect(settings.hooks.PreToolUse[0]!.hooks).toHaveLength(1);
    expect(settings.hooks.PreToolUse[0]!.hooks[0]!.type).toBe("command");
    expect(settings.hooks.PreToolUse[0]!.hooks[0]!.command).toBe("phax __approve-protected-path");
  });

  it("encodes approved paths as JSON in the PHAX_APPROVED_PATHS env var", () => {
    const approved = ["/abs/work/.claude/skills/a.md", "/abs/work/.claude/skills/b.md"];
    const settings = buildProtectedPathHookSettings(approved, "phax __approve-protected-path");
    const encoded = settings.env[PHAX_APPROVED_PATHS_ENV];
    expect(encoded).toBeDefined();
    expect(JSON.parse(encoded!)).toEqual(approved);
  });

  it("produces an empty env array when no approved paths are provided", () => {
    const settings = buildProtectedPathHookSettings([], "phax __approve-protected-path");
    const encoded = settings.env[PHAX_APPROVED_PATHS_ENV];
    expect(encoded).toBeDefined();
    expect(JSON.parse(encoded!)).toEqual([]);
  });
});

// ── buildArgs --settings flag ─────────────────────────────────────────────────

describe("buildArgs — --settings flag", () => {
  it("appends --settings <path> when settingsFilePath is provided", () => {
    const args = buildArgs(baseOptions(securePolicy), undefined, "/tmp/work/claude-approval.json");
    expect(args).toContain("--settings");
    const idx = args.indexOf("--settings");
    expect(args[idx + 1]).toBe("/tmp/work/claude-approval.json");
  });

  it("omits --settings when settingsFilePath is absent", () => {
    const args = buildArgs(baseOptions(securePolicy));
    expect(args).not.toContain("--settings");
  });

  it("omits --settings when settingsFilePath is undefined", () => {
    const args = buildArgs(baseOptions(securePolicy), undefined, undefined);
    expect(args).not.toContain("--settings");
  });
});

// ── writeProtectedPathSettings ────────────────────────────────────────────────

describe("writeProtectedPathSettings", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "phax-hook-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes the settings file and returns its absolute path when paths are non-empty", () => {
    const approved = [join(tmpDir, ".claude/skills/my-skill/SKILL.md")];
    const result = writeProtectedPathSettings(tmpDir, approved);
    expect(result).toBeDefined();
    expect(result!.endsWith("claude-protected-approval.settings.json")).toBe(true);
    expect(existsSync(result!)).toBe(true);
    const content = JSON.parse(readFileSync(result!, "utf8")) as unknown;
    expect(content).toMatchObject({
      hooks: {
        PreToolUse: [{ matcher: "Edit|Write|MultiEdit" }],
      },
    });
  });

  it("returns undefined when approvedProtectedPaths is empty", () => {
    const result = writeProtectedPathSettings(tmpDir, []);
    expect(result).toBeUndefined();
  });

  it("returns undefined when approvedProtectedPaths is undefined", () => {
    const result = writeProtectedPathSettings(tmpDir, undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined when phaseFolderPath is undefined", () => {
    const result = writeProtectedPathSettings(undefined, ["/abs/path"]);
    expect(result).toBeUndefined();
  });
});

// ── Hook payload decode ───────────────────────────────────────────────────────

describe("parseClaudeHookPayload", () => {
  it("decodes a valid PreToolUse payload", () => {
    const payload = parseClaudeHookPayload(
      JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: "/abs/path/SKILL.md" },
      }),
    );
    expect(payload).toBeDefined();
    expect(payload!.tool_name).toBe("Edit");
    expect(payload!.tool_input.file_path).toBe("/abs/path/SKILL.md");
  });

  it("tolerates and ignores extra fields in the payload", () => {
    const payload = parseClaudeHookPayload(
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "/abs/path/x.ts", extra_field: "ignored" },
        unknown_top_level: true,
      }),
    );
    expect(payload).toBeDefined();
    expect(payload!.tool_name).toBe("Write");
  });

  it("returns undefined for non-JSON input", () => {
    expect(parseClaudeHookPayload("not-json")).toBeUndefined();
  });

  it("returns undefined when tool_name is missing", () => {
    expect(
      parseClaudeHookPayload(JSON.stringify({ tool_input: { file_path: "/x" } })),
    ).toBeUndefined();
  });
});

// ── Domain decision (hook logic) ──────────────────────────────────────────────

describe("decideProtectedPathApproval via hook logic", () => {
  const approved = ["/abs/work/.claude/skills/my-skill/SKILL.md"];

  it("allows Edit on an approved absolute path", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: approved,
        toolName: "Edit",
        filePath: "/abs/work/.claude/skills/my-skill/SKILL.md",
      }),
    ).toBe("allow");
  });

  it("allows Write on an approved absolute path", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: approved,
        toolName: "Write",
        filePath: "/abs/work/.claude/skills/my-skill/SKILL.md",
      }),
    ).toBe("allow");
  });

  it("allows MultiEdit on an approved absolute path", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: approved,
        toolName: "MultiEdit",
        filePath: "/abs/work/.claude/skills/my-skill/SKILL.md",
      }),
    ).toBe("allow");
  });

  it("defers for a non-approved path", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: approved,
        toolName: "Edit",
        filePath: "/abs/work/.claude/skills/other/SKILL.md",
      }),
    ).toBe("defer");
  });

  it("defers for a non-edit tool (e.g. Bash)", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: approved,
        toolName: "Bash",
        filePath: "/abs/work/.claude/skills/my-skill/SKILL.md",
      }),
    ).toBe("defer");
  });

  it("defers when filePath is undefined", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: approved,
        toolName: "Edit",
        filePath: undefined,
      }),
    ).toBe("defer");
  });

  it("defers when approved list is empty", () => {
    expect(
      decideProtectedPathApproval({
        approvedAbsolutePaths: [],
        toolName: "Edit",
        filePath: "/abs/work/.claude/skills/my-skill/SKILL.md",
      }),
    ).toBe("defer");
  });
});
