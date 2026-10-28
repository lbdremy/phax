import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionFailedError,
  RateLimitError,
  type UsageLimitError,
} from "../../src/domain/errors.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import type { SessionFailure } from "../../src/domain/session/outcome.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { Backend, type AgentRunOptions, type CompletionOptions } from "../../src/ports/backend.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { makeFakeProviderCli, type FakeProviderCli } from "../helpers/fakeProviderCli.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { VIBE3_EXPORT_SHORT, VIBE3_SESSION_ID, writeFakeVibe } from "../helpers/vibe3Fixtures.js";

// The adapters read every ended session through their outcome reader. These
// drive the real node backend against fake `claude`, `codex` and `vibe`
// executables (PATH and HOME point into a temporary directory), and hold the
// fake backend to the same error shape for the same failure.

const SESSION = "3f9a0c1d-6e2b-4c7a-8d15-b0e4f7a29c68";

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
  failClosed: false,
};

let root: string;
let worktree: string;
let phaseFolder: string;
let transcript: string;
let logPath: string;
let cli: FakeProviderCli;
let vibePath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "phax-session-failures-"));
  worktree = join(root, "worktree");
  phaseFolder = join(root, "runs", "phase-02");
  mkdirSync(worktree, { recursive: true });
  mkdirSync(phaseFolder, { recursive: true });
  transcript = join(phaseFolder, "output.jsonl");
  logPath = join(phaseFolder, "agent-error.log");
  cli = makeFakeProviderCli(root);
  vibePath = join(root, "vibe-bin", "vibe");
  for (const [name, value] of Object.entries(cli.env)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  removeTempDir(root);
});

function providerConfig(): ProviderConfig {
  return {
    providers: {
      "claude-code": { enabled: true, executable: "claude" },
      "codex-cli": {
        enabled: true,
        executable: cli.codexPath,
        families: {
          "openai-gpt": {
            models: [{ id: "gpt-6-luna", efforts: ["low", "medium", "high"], status: "active" }],
          },
        },
      },
      "mistral-vibe": { enabled: true, executable: vibePath, modelEnvVar: "VIBE_ACTIVE_MODEL" },
    },
  };
}

const runOptions = (provider: AgentRunOptions["provider"]): AgentRunOptions => ({
  provider,
  model: provider === "codex-cli" ? "gpt-6-luna" : "claude-sonnet-5-5",
  effort: "medium",
  cwd: worktree,
  security: unsafePolicy,
  outputJsonlPath: transcript,
  phaseFolderPath: phaseFolder,
});

type SessionError = AgentSessionFailedError | RateLimitError | UsageLimitError;

async function runAgentFailure(provider: AgentRunOptions["provider"]): Promise<SessionError> {
  const result = await Effect.runPromise(
    Backend.pipe(
      Effect.flatMap((backend) => backend.runAgent("do the phase", runOptions(provider))),
      Effect.either,
      Effect.provide(makeNodeBackendLayer(providerConfig())),
    ),
  );
  if (Either.isRight(result)) throw new Error("expected the session to fail");
  return result.left as SessionError;
}

async function completeOutcome(provider: CompletionOptions["provider"]) {
  return Effect.runPromise(
    Backend.pipe(
      Effect.flatMap((backend) =>
        backend.complete("answer", {
          provider,
          model: provider === "codex-cli" ? "gpt-6-luna" : "claude-sonnet-5-5",
          effort: "medium",
          cwd: worktree,
        }),
      ),
      Effect.either,
      Effect.provide(makeNodeBackendLayer(providerConfig())),
    ),
  );
}

const claudeInit = { type: "system", subtype: "init", session_id: SESSION, tools: [] };
const claudeResult = (fields: Record<string, unknown>) => ({
  type: "result",
  is_error: true,
  session_id: SESSION,
  ...fields,
});

describe("the Claude Code adapter fails a session through its reader", () => {
  it("fails an error_during_execution transcript as provider-error, with the session id and both files", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [claudeInit, claudeResult({ subtype: "error_during_execution" })],
      stderr: "boom\n",
      exitCode: 1,
    });

    const error = await runAgentFailure("claude-code");

    expect(error).toBeInstanceOf(AgentSessionFailedError);
    expect(error).toMatchObject({
      message: "claude-code session failed (provider-error): error_during_execution",
      failure: {
        provider: "claude-code",
        kind: "provider-error",
        message: "error_during_execution",
        sessionId: SESSION,
        resetAt: null,
      },
      agentErrorLog: logPath,
      transcript,
    });
    expect(existsSync(join(phaseFolder, "claude-session-id.txt"))).toBe(false);
  });

  it("opens agent-error.log with the failure, then argv, exit code and stderr", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [
        claudeInit,
        claudeResult({
          subtype: "success",
          result: "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
        }),
      ],
      stderr: "boom\n",
      exitCode: 1,
    });

    const error = await runAgentFailure("claude-code");

    const log = readFileSync(logPath, "utf8");
    expect(
      log.startsWith(
        [
          "failure: network",
          "provider: claude-code",
          "message: API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
          `session: ${SESSION}`,
          `transcript: ${transcript}`,
          "",
          "claude --print --output-format stream-json --verbose ",
        ].join("\n"),
      ),
    ).toBe(true);
    expect(log.endsWith("\nexit code: 1\n\nboom\n")).toBe(true);
    expect(error).toBeInstanceOf(AgentSessionFailedError);
  });

  it("writes the session id of an error_max_turns session on the log's session line", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [claudeInit, claudeResult({ subtype: "error_max_turns", errors: ["max turns"] })],
      exitCode: 1,
    });

    const error = await runAgentFailure("claude-code");

    expect(error).toMatchObject({ failure: { kind: "max-turns", sessionId: SESSION } });
    expect(readFileSync(logPath, "utf8").split("\n")).toContain(`session: ${SESSION}`);
  });

  it("writes session: none for a session that failed before reporting one, still naming its files", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [],
      stderr: "Error: the configuration file is not valid JSON\n",
      exitCode: 1,
    });

    const error = await runAgentFailure("claude-code");

    expect(error).toMatchObject({
      failure: {
        kind: "provider-error",
        message: "Error: the configuration file is not valid JSON",
        sessionId: null,
      },
      agentErrorLog: logPath,
      transcript,
    });
    expect(readFileSync(logPath, "utf8").split("\n")).toContain("session: none");
  });

  it("reports a session ended by SIGTERM as killed, not as a limit", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "", stream: [claudeInit], signal: "SIGTERM" });

    const error = await runAgentFailure("claude-code");

    expect(error).toBeInstanceOf(AgentSessionFailedError);
    expect((error as AgentSessionFailedError).failure.kind).toBe("killed");
  });

  it("never reads a 429 printed by a tool as a rate limit", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [
        claudeInit,
        {
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "HTTP 429 Too Many Requests" }],
          },
        },
        claudeResult({ subtype: "error_during_execution" }),
      ],
      exitCode: 1,
    });

    const error = await runAgentFailure("claude-code");

    expect(error).toBeInstanceOf(AgentSessionFailedError);
    expect((error as AgentSessionFailedError).failure.kind).toBe("provider-error");
  });

  it("names agent-error.log and the transcript on a rate limit's error", async () => {
    cli.setScript({ sessionId: SESSION, finalText: "", rateLimit: true });

    const error = await runAgentFailure("claude-code");

    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      message: "claude-code session failed (rate-limit): API Error: rate limit exceeded",
      rawMessage: "API Error: rate limit exceeded",
      agentErrorLog: logPath,
      transcript,
    });
    expect(readFileSync(logPath, "utf8")).toMatch(/^failure: rate-limit\n/);
  });

  it("answers a session that reported success, then exited non-zero", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [
        claudeInit,
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "done",
          session_id: SESSION,
        },
      ],
      exitCode: 1,
    });

    const result = await Effect.runPromise(
      Backend.pipe(
        Effect.flatMap((backend) => backend.runAgent("do the phase", runOptions("claude-code"))),
        Effect.provide(makeNodeBackendLayer(providerConfig())),
      ),
    );

    expect(result).toMatchObject({ sessionId: SESSION, finalText: "done" });
  });
});

describe("the Codex and Vibe adapters fail with the provider's own text", () => {
  it("fails a codex turn.failed with its message, never the exit code", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [
        { type: "thread.started", thread_id: SESSION },
        { type: "turn.started" },
        { type: "turn.failed", error: { message: "unexpected status 500 Internal Server Error" } },
      ],
      exitCode: 1,
    });

    const error = await runAgentFailure("codex-cli");

    expect(error).toMatchObject({
      message:
        "codex-cli session failed (provider-error): unexpected status 500 Internal Server Error",
      failure: { kind: "provider-error", sessionId: SESSION },
      agentErrorLog: logPath,
      transcript,
    });
    expect(error.message).not.toContain("exited with code");
  });

  it("fails a codex completion that exits 0 with no answer message", async () => {
    cli.setScript({
      sessionId: SESSION,
      finalText: "",
      stream: [{ type: "thread.started", thread_id: SESSION }, { type: "turn.completed" }],
    });

    const result = await completeOutcome("codex-cli");

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(AgentSessionFailedError);
      expect((result.left as AgentSessionFailedError).failure.kind).toBe("provider-error");
    }
  });

  it("fails a vibe turn whose export reports an internal error with Vibe's text", async () => {
    writeFakeVibe(join(root, "vibe-bin"), {
      exitCode: 2,
      stderr: "vibe: internal error\n",
      exportText: JSON.stringify({
        ...VIBE3_EXPORT_SHORT,
        usage: null,
        cost_usd: null,
        outcome: "infrastructure_failure",
        exit_code: 2,
        error: { message: "Internal server error", code: "internal_error" },
      }),
    });

    const error = await runAgentFailure("mistral-vibe");

    expect(error).toMatchObject({
      message:
        "mistral-vibe session failed (provider-error): Internal server error (internal_error)",
      failure: { kind: "provider-error", sessionId: VIBE3_SESSION_ID },
      agentErrorLog: logPath,
      transcript,
    });
    expect(error.message).not.toContain("exited with code");
  });
});

// What the contract compares between the fake backend's error and an adapter's.
const shapeOf = (error: SessionError) => ({
  kind: error.constructor.name,
  message: error.message,
  failure: error instanceof AgentSessionFailedError ? error.failure : undefined,
  rawMessage: error instanceof AgentSessionFailedError ? undefined : error.rawMessage,
  agentErrorLog: error.agentErrorLog,
  transcript: error.transcript,
});

// The same failure, read by a real adapter from a transcript and queued on the
// fake backend, raises the same error.
describe("contract: the fake backend raises what the adapters raise", () => {
  const cases: readonly {
    readonly name: string;
    readonly script: Parameters<FakeProviderCli["setScript"]>[0];
    readonly failure: SessionFailure;
  }[] = [
    {
      name: "a network failure",
      script: {
        sessionId: SESSION,
        finalText: "",
        stream: [
          claudeInit,
          claudeResult({ subtype: "success", result: "API Error: Connection error." }),
        ],
        exitCode: 1,
      },
      failure: {
        provider: "claude-code",
        kind: "network",
        message: "API Error: Connection error.",
        sessionId: SESSION,
        resetAt: null,
      },
    },
    {
      name: "a max-turns failure",
      script: {
        sessionId: SESSION,
        finalText: "",
        stream: [claudeInit, claudeResult({ subtype: "error_max_turns" })],
        exitCode: 1,
      },
      failure: {
        provider: "claude-code",
        kind: "max-turns",
        message: "error_max_turns",
        sessionId: SESSION,
        resetAt: null,
      },
    },
    {
      name: "a rate limit",
      script: { sessionId: SESSION, finalText: "", rateLimit: true },
      failure: {
        provider: "claude-code",
        kind: "rate-limit",
        message: "API Error: rate limit exceeded",
        sessionId: SESSION,
        resetAt: null,
      },
    },
  ];

  it.each(cases)("$name", async ({ script, failure }) => {
    cli.setScript(script);
    const real = await runAgentFailure("claude-code");

    const fake = makeFakeBackend();
    fake.impl.failRunWith(0, failure, { agentErrorLog: logPath, transcript });
    const faked = await Effect.runPromise(
      Backend.pipe(
        Effect.flatMap((backend) => backend.runAgent("do the phase", runOptions("claude-code"))),
        Effect.flip,
        Effect.provide(fake.layer),
      ),
    );

    expect(shapeOf(faked as SessionError)).toEqual(shapeOf(real));
  });
});
