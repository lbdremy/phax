import { Effect, Result } from "effect";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentInvocationError } from "../../../src/domain/errors.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../../src/domain/routing/defaults.js";
import { CODE_REVIEW_AGENT_COMMANDS } from "../../../src/domain/security/agentCommands.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import { runVibeAgent, runVibeCompletion } from "../../../src/infra/providers/mistralVibe.js";
import type { AgentRunOptions, CompletionOptions } from "../../../src/ports/backend.js";
import { answerJsonSchema } from "../../../src/schemas/answerSchemas.js";
import { removeTempDir } from "../../helpers/tempGit.js";
import {
  VIBE3_EXPORT_SHORT,
  VIBE3_SESSION_ID,
  vibe3ExportText,
  writeFakeVibe,
} from "../../helpers/vibe3Fixtures.js";

// Acceptance tests of the next phase: a Vibe session's model and thinking level
// are chosen with Vibe 3.1.3's own `--model` and `--thinking` flags, and a
// confined turn is checked afterwards for both. Every test is an expected
// failure until that phase passes it. The fake `vibe` mirrors Vibe 3.1.3 (see
// tests/helpers/vibe3Fixtures.ts): a new session's flags set the export's
// `config.active_model` and `config.models[<alias>].thinking`, a resume
// restores them, and a resume given `--model` exits 1.

const MODEL = "mistral-medium-3.5";

describe("Vibe model and thinking flags against a fake vibe", () => {
  let root: string;
  let phaseFolder: string;
  let transcript: string;
  let n = 0;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "phax-vibe-model-flags-"));
    phaseFolder = join(root, "phase-01");
    mkdirSync(phaseFolder, { recursive: true });
    transcript = join(phaseFolder, "output.jsonl");
    // No real ~/.vibe is read, and a variable phax's own environment carries
    // must not reach a headless turn.
    vi.stubEnv("VIBE_HOME", join(root, "vibe-home"));
    vi.stubEnv("VIBE_ACTIVE_MODEL", "inherited-from-phax-environment");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeTempDir(root);
  });

  const securePolicy = (): SecurityPolicy => ({
    mode: "secure",
    filesystem: { allowRead: [root], allowWrite: [root] },
    network: { profile: "provider-only" },
    mcp: { mode: "disabled", allow: [] },
    agentCommands: [],
    failClosed: true,
  });

  const fakeIn = (options: Parameters<typeof writeFakeVibe>[1] = {}) => {
    n += 1;
    return writeFakeVibe(join(root, `bin-${n}`), options);
  };
  const entryOf = (executable: string) => {
    const entry = { ...DEFAULT_PROVIDER_CONFIG.providers["mistral-vibe"]!, executable };
    return entry;
  };
  const agentOptions = (
    effort: string,
    extra: Partial<AgentRunOptions> = {},
    outputJsonlPath: string = transcript,
  ): AgentRunOptions => ({
    provider: "mistral-vibe",
    model: MODEL,
    effort,
    cwd: root,
    security: securePolicy(),
    outputJsonlPath,
    phaseFolderPath: phaseFolder,
    ...extra,
  });
  const runAgent = (executable: string, options: AgentRunOptions, resumeSessionId?: string) =>
    Effect.runPromise(
      Effect.result(runVibeAgent("print ok", options, entryOf(executable), resumeSessionId)),
    );
  const runCompletion = (executable: string, options: CompletionOptions) =>
    Effect.runPromise(Effect.result(runVibeCompletion("say PONG", options, entryOf(executable))));
  const valueAfter = (argv: readonly string[], flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const refusalOf = async (
    executable: string,
    options: AgentRunOptions,
  ): Promise<AgentInvocationError> => {
    const result = await runAgent(executable, options);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isSuccess(result)) throw new Error("expected the turn to be refused");
    expect(result.failure).toBeInstanceOf(AgentInvocationError);
    return result.failure as AgentInvocationError;
  };
  const exportPath = () => join(phaseFolder, "output.vibe-export", "export.json");
  const exportText = () => vibe3ExportText(VIBE3_EXPORT_SHORT);

  it.fails("passes --model and --thinking to a secure first turn and no VIBE_ACTIVE_MODEL (ac-first-turn-flags)", async () => {
    const fake = fakeIn({ exportText: exportText() });

    const result = await runAgent(fake.executable, agentOptions("high"));

    expect(Result.isSuccess(result)).toBe(true);
    const [trace] = fake.traces();
    expect(trace).toBeDefined();
    expect(valueAfter(trace!.argv, "--model")).toBe(MODEL);
    expect(valueAfter(trace!.argv, "--thinking")).toBe("high");
    expect(trace!.env).not.toHaveProperty("VIBE_ACTIVE_MODEL");
  });

  // Each row mirrors the options its use case passes to the backend: the
  // authoring, code review, compliance review and decide sessions are read-only
  // and answer a schema; extraction is a completion with a schema; the sealed
  // completion has neither.
  const agentRows: readonly {
    readonly kind: string;
    readonly extra: Partial<AgentRunOptions>;
  }[] = [
    {
      kind: "authoring",
      extra: {
        readOnly: true,
        answerSchema: { call: "authoring", schema: answerJsonSchema("spec-document") },
      },
    },
    {
      kind: "code-review",
      extra: {
        security: { ...securePolicy(), agentCommands: [...CODE_REVIEW_AGENT_COMMANDS] },
        agentCommands: CODE_REVIEW_AGENT_COMMANDS,
        readOnly: true,
        answerSchema: { call: "code-review", schema: answerJsonSchema("code-review-answer") },
      },
    },
    {
      kind: "compliance-review",
      extra: {
        security: { ...securePolicy(), agentCommands: [...CODE_REVIEW_AGENT_COMMANDS] },
        agentCommands: CODE_REVIEW_AGENT_COMMANDS,
        readOnly: true,
        answerSchema: {
          call: "compliance-review",
          schema: answerJsonSchema("compliance-review-answer"),
        },
      },
    },
    {
      kind: "decide",
      extra: {
        readOnly: true,
        answerSchema: { call: "decide-handback", schema: answerJsonSchema("spec-document") },
      },
    },
  ];

  it.fails.each(agentRows)(
    "passes --model and --thinking off to a new $kind session and no VIBE_ACTIVE_MODEL (ac-every-new-session)",
    async ({ extra }) => {
      const fake = fakeIn({ exportText: exportText() });

      const result = await runAgent(fake.executable, agentOptions("off", extra));

      expect(Result.isSuccess(result)).toBe(true);
      const [trace] = fake.traces();
      expect(trace).toBeDefined();
      expect(valueAfter(trace!.argv, "--model")).toBe(MODEL);
      expect(valueAfter(trace!.argv, "--thinking")).toBe("off");
      expect(trace!.env).not.toHaveProperty("VIBE_ACTIVE_MODEL");
    },
  );

  const completionRows: readonly {
    readonly kind: string;
    readonly extra: Partial<CompletionOptions>;
  }[] = [
    {
      kind: "extraction",
      extra: {
        answerSchema: { call: "plan-extraction", schema: answerJsonSchema("phax-plan-extraction") },
      },
    },
    { kind: "sealed completion", extra: {} },
  ];

  it.fails.each(completionRows)(
    "passes --model and --thinking off to a new $kind session and no VIBE_ACTIVE_MODEL (ac-every-new-session)",
    async ({ extra }) => {
      const fake = fakeIn();

      const result = await runCompletion(fake.executable, {
        provider: "mistral-vibe",
        model: MODEL,
        effort: "off",
        cwd: root,
        ...extra,
      });

      expect(Result.isSuccess(result)).toBe(true);
      const [trace] = fake.traces();
      expect(trace).toBeDefined();
      expect(valueAfter(trace!.argv, "--model")).toBe(MODEL);
      expect(valueAfter(trace!.argv, "--thinking")).toBe("off");
      expect(trace!.env).not.toHaveProperty("VIBE_ACTIVE_MODEL");
    },
  );

  it.fails("resumes a session with --resume and neither --model nor --thinking, and no VIBE_ACTIVE_MODEL (ac-resume-no-flags)", async () => {
    const fake = fakeIn({ exportText: exportText() });
    const first = await runAgent(fake.executable, agentOptions("high"));
    expect(Result.isSuccess(first)).toBe(true);

    const resumed = await runAgent(
      fake.executable,
      agentOptions("high", {}, join(phaseFolder, "fix-attempt-01.jsonl")),
      VIBE3_SESSION_ID,
    );

    expect(Result.isSuccess(resumed)).toBe(true);
    const traces = fake.traces();
    expect(traces).toHaveLength(2);
    const resumeTrace = traces[1]!;
    expect(valueAfter(resumeTrace.argv, "--resume")).toBe(VIBE3_SESSION_ID);
    expect(resumeTrace.argv).not.toContain("--model");
    expect(resumeTrace.argv).not.toContain("--thinking");
    expect(resumeTrace.env).not.toHaveProperty("VIBE_ACTIVE_MODEL");
  });

  it.fails("refuses a vibe older than 3.1.3 before any session spawns, for a turn and a completion (ac-floor)", async () => {
    const message =
      "mistral-vibe 3.1.2 is installed; phax needs 3.1.3 or later.\nUpgrade it: uv tool upgrade mistral-vibe";
    const old = fakeIn({ version: "vibe 3.1.2", exportText: exportText() });

    const error = await refusalOf(old.executable, agentOptions("high"));

    expect(error.message).toBe(message);
    expect(old.turns()).toBe(0);

    const oldToo = fakeIn({ version: "vibe 3.1.2" });
    const completion = await runCompletion(oldToo.executable, {
      provider: "mistral-vibe",
      model: MODEL,
      effort: "high",
      cwd: root,
    });

    expect(Result.isFailure(completion)).toBe(true);
    if (Result.isSuccess(completion)) return;
    expect(completion.failure).toBeInstanceOf(AgentInvocationError);
    expect(completion.failure.message).toBe(message);
    expect(oldToo.turns()).toBe(0);
  });

  it.fails("refuses a confined turn whose export reports another active_model (ac-model-mismatch)", async () => {
    const fake = fakeIn({
      exportText: exportText(),
      configOverride: { active_model: "mistral-large-4-0" },
    });

    const error = await refusalOf(fake.executable, agentOptions("high"));

    expect(error.message).toContain("active_model");
    expect(error.message).toContain('"mistral-large-4-0"');
    expect(error.message).toContain(`"${MODEL}"`);
    expect(error.message).toContain(exportPath());
    expect(existsSync(join(phaseFolder, "claude-session-id.txt"))).toBe(false);
  });

  it.fails("refuses a confined turn whose export reports another thinking level (ac-level-mismatch)", async () => {
    const fake = fakeIn({
      exportText: exportText(),
      configOverride: { models: { [MODEL]: { alias: MODEL, thinking: "high" } } },
    });

    const error = await refusalOf(fake.executable, agentOptions("off"));

    expect(error.message).toContain("thinking");
    expect(error.message).toContain('"high"');
    expect(error.message).toContain('"off"');
    expect(error.message).toContain(exportPath());
    expect(existsSync(join(phaseFolder, "claude-session-id.txt"))).toBe(false);
  });

  it.fails("refuses a confined turn whose export holds no thinking level for the alias (ac-level-absent)", async () => {
    const fake = fakeIn({
      exportText: exportText(),
      configOverride: { models: { [MODEL]: { alias: MODEL } } },
    });

    const error = await refusalOf(fake.executable, agentOptions("off"));

    expect(error.message).toContain("thinking");
    expect(error.message).toContain("absent");
    expect(error.message).toContain('"off"');
    expect(error.message).toContain(exportPath());
    expect(existsSync(join(phaseFolder, "claude-session-id.txt"))).toBe(false);
  });
});
