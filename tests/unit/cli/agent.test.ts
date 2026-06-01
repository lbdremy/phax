import { describe, expect, it, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import {
  runAgentModels,
  runAgentResolve,
  runAgentProbe,
  runAgentSetupMistralVibe,
} from "../../../src/cli/commands/agent.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../../src/domain/routing/defaults.js";
import type { ModelRouting } from "../../../src/schemas/modelRouting.js";

// Mock loadRouting so tests don't touch the filesystem
vi.mock("../../../src/app/loadRouting.js", () => ({
  loadModelRouting: vi.fn(() => Effect.succeed(DEFAULT_MODEL_ROUTING)),
  loadProviderConfig: vi.fn(() => Effect.succeed(DEFAULT_PROVIDER_CONFIG)),
}));

// Mock vibeSetup for the setup tests
vi.mock("../../../src/app/vibeSetup.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/app/vibeSetup.js")>();
  return {
    ...original,
    vibeSetup: vi.fn(),
  };
});

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
}

describe("runAgentModels", () => {
  it("prints provider priority and tiers, exits 0", async () => {
    const { out, lines } = makeOutput();
    const code = await runAgentModels(out);
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Provider priority:");
    expect(text).toContain("claude-code");
    expect(text).toContain("Tiers:");
    expect(text).toContain("standard:");
  });

  it("marks disabled providers", async () => {
    const { loadModelRouting } = vi.mocked(await import("../../../src/app/loadRouting.js"));
    const routing: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      providerPriority: ["mistral-vibe", "claude-code"],
    };
    loadModelRouting.mockReturnValue(Effect.succeed(routing));

    const { out, lines } = makeOutput();
    await runAgentModels(out);
    const text = lines.join("\n");
    expect(text).toContain("(disabled)");

    // Reset to default
    loadModelRouting.mockReturnValue(Effect.succeed(DEFAULT_MODEL_ROUTING));
  });
});

describe("runAgentResolve", () => {
  beforeEach(async () => {
    const { loadModelRouting, loadProviderConfig } = vi.mocked(
      await import("../../../src/app/loadRouting.js"),
    );
    loadModelRouting.mockReturnValue(Effect.succeed(DEFAULT_MODEL_ROUTING));
    loadProviderConfig.mockReturnValue(Effect.succeed(DEFAULT_PROVIDER_CONFIG));
  });

  it("resolves claude-sonnet-4-6/medium and prints human output, exits 0", async () => {
    const { out, lines } = makeOutput();
    const code = await runAgentResolve({ model: "claude-sonnet-4-6", effort: "medium" }, out);
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("claude-sonnet-4-6");
    expect(text).toContain("standard");
    expect(text).toContain("claude-code");
  });

  it("outputs valid JSON when --json is set", async () => {
    const { out, lines } = makeOutput();
    const code = await runAgentResolve(
      { model: "claude-sonnet-4-6", effort: "medium", json: true },
      out,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(lines.join(""));
    expect(parsed).toHaveProperty("requested");
    expect(parsed).toHaveProperty("selected");
    expect(parsed).toHaveProperty("relationship");
    expect(parsed).toHaveProperty("reason");
  });

  it("returns exit code 2 for an invalid effort level", async () => {
    const { out, errors } = makeOutput();
    const code = await runAgentResolve({ model: "claude-sonnet-4-6", effort: "bogus" }, out);
    expect(code).toBe(2);
    expect(errors.join("")).toContain("Invalid effort level");
  });

  it("resolves with mistral-vibe priority and shows mistral-vibe as provider", async () => {
    const { loadModelRouting } = vi.mocked(await import("../../../src/app/loadRouting.js"));
    const routing: ModelRouting = {
      ...DEFAULT_MODEL_ROUTING,
      providerPriority: ["mistral-vibe", "claude-code"],
    };
    loadModelRouting.mockReturnValue(Effect.succeed(routing));

    const { out, lines } = makeOutput();
    const code = await runAgentResolve({ model: "claude-sonnet-4-6", effort: "medium" }, out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("mistral-vibe");
  });
});

describe("runAgentProbe", () => {
  beforeEach(async () => {
    const { loadModelRouting, loadProviderConfig } = vi.mocked(
      await import("../../../src/app/loadRouting.js"),
    );
    loadModelRouting.mockReturnValue(Effect.succeed(DEFAULT_MODEL_ROUTING));
    loadProviderConfig.mockReturnValue(Effect.succeed(DEFAULT_PROVIDER_CONFIG));
  });

  it("reports a status for each provider and exits 0 even when none are available", async () => {
    const { out, lines } = makeOutput();
    // Real NodeShellLayer is used — claude/vibe/codex won't be found in test env,
    // so all will be "unavailable". This validates the no-throw guarantee.
    const code = await runAgentProbe(out);
    expect(code).toBe(0);
    const text = lines.join("\n");
    // All three providers must appear in output
    expect(text).toContain("claude-code");
    expect(text).toContain("mistral-vibe");
    expect(text).toContain("codex-cli");
  });
});

describe("runAgentSetupMistralVibe", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("dry-run lists aliases that would be added, makes no writes", async () => {
    const { vibeSetup } = vi.mocked(await import("../../../src/app/vibeSetup.js"));
    vi.mocked(vibeSetup).mockReturnValue(
      Effect.succeed({
        aliasesAdded: [
          "phax-mistral-medium-3.5-off",
          "phax-mistral-medium-3.5-low",
          "phax-mistral-medium-3.5-medium",
          "phax-mistral-medium-3.5-high",
          "phax-mistral-medium-3.5-max",
        ],
        aliasesSkipped: [],
        backupPath: undefined,
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runAgentSetupMistralVibe({ dryRun: true }, out);
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Dry run");
    expect(text).toContain("phax-mistral-medium-3.5-off");
    expect(vi.mocked(vibeSetup)).toHaveBeenCalledWith({ dryRun: true });
  });

  it("install prints appended aliases and backup path", async () => {
    const { vibeSetup } = vi.mocked(await import("../../../src/app/vibeSetup.js"));
    vi.mocked(vibeSetup).mockReturnValue(
      Effect.succeed({
        aliasesAdded: ["phax-mistral-medium-3.5-off", "phax-mistral-medium-3.5-low"],
        aliasesSkipped: [
          "phax-mistral-medium-3.5-medium",
          "phax-mistral-medium-3.5-high",
          "phax-mistral-medium-3.5-max",
        ],
        backupPath: "/home/user/.vibe/config.toml.phax-backup-12345",
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runAgentSetupMistralVibe({ installModelAliases: true }, out);
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("Appended 2 alias(es)");
    expect(text).toContain("phax-mistral-medium-3.5-off");
    expect(text).toContain("phax-backup-12345");
    expect(vi.mocked(vibeSetup)).toHaveBeenCalledWith({ install: true });
  });

  it("no-op when all aliases already present", async () => {
    const { vibeSetup } = vi.mocked(await import("../../../src/app/vibeSetup.js"));
    vi.mocked(vibeSetup).mockReturnValue(
      Effect.succeed({
        aliasesAdded: [],
        aliasesSkipped: [
          "phax-mistral-medium-3.5-off",
          "phax-mistral-medium-3.5-low",
          "phax-mistral-medium-3.5-medium",
          "phax-mistral-medium-3.5-high",
          "phax-mistral-medium-3.5-max",
        ],
        backupPath: undefined,
      }),
    );

    const { out, lines } = makeOutput();
    const code = await runAgentSetupMistralVibe({ installModelAliases: true }, out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("already present");
  });
});
