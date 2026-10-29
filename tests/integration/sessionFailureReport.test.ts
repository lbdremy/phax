import { afterEach, describe, expect, it, vi } from "vitest";
import { runArtifactDecide } from "../../src/cli/commands/artifactDecide.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import { readClaudeOutcome } from "../../src/domain/session/outcome.js";
import type { SessionFailure } from "../../src/domain/session/outcome.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import { SPEC_FRONTMATTER, useDecideRepo } from "../helpers/decideVerdictsHarness.js";
import { FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The terminal report of a failed agent session, end to end through
// `runArtifactDecide --verdicts`: a fake backend failing the writer with the
// failure the Claude reader gives for the DNS outage transcript (ten
// api_retry events, then the synthetic API Error), in a temporary repository.

const SPEC_JSON = SPEC_PATH.replace(/\.md$/, ".json");
const SESSION = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
const API_ERROR = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
const world = useDecideRepo();

function dnsOutage(withSession: boolean): SessionFailure {
  const sessionId = withSession ? SESSION : undefined;
  const lines = [
    ...(withSession ? [{ type: "system", subtype: "init", session_id: SESSION }] : []),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((attempt) => ({
      type: "system",
      subtype: "api_retry",
      attempt,
      max_retries: 10,
      retry_delay_ms: 500 * 2 ** (attempt - 1),
      error_status: null,
      error: "unknown",
      ...(sessionId === undefined ? {} : { session_id: sessionId }),
    })),
    {
      type: "assistant",
      message: {
        model: "<synthetic>",
        role: "assistant",
        content: [{ type: "text", text: API_ERROR }],
      },
      error: "server_error",
      is_api_error_message: true,
      ...(sessionId === undefined ? {} : { session_id: sessionId }),
    },
    {
      type: "result",
      subtype: "success",
      is_error: true,
      terminal_reason: "api_error",
      api_error_status: null,
      result: API_ERROR,
      ...(sessionId === undefined ? {} : { session_id: sessionId }),
    },
  ];
  const outcome = readClaudeOutcome({
    lines: lines.map((line) => JSON.stringify(line)),
    stderr: "",
    end: { kind: "exited", code: 1 },
  });
  if (outcome.kind !== "failure") throw new Error("the DNS outage must read as a failure");
  return outcome.failure;
}

function makeOutput() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const logs: string[] = [];
  return {
    out: {
      log: (m: string) => logs.push(m),
      warn: (m: string) => warnings.push(m),
      error: (m: string) => errors.push(m),
    },
    errors,
  };
}

function seed(): void {
  world.writeRepoFile(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  world.writeRepoFile(SPEC_PATH, SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument));
  world.writeRepoFile(SPEC_JSON, serializeSidecar(SPEC));
  world.writeRepoFile("verdicts.json", FILE_VALID);
  world.commitAll();
}

async function decideWith(
  failure: SessionFailure,
  files: { agentErrorLog: string | null; transcript: string | null },
) {
  seed();
  vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
  const backend = makeFakeBackend();
  backend.impl.failRunWith(0, failure, files);
  const o = makeOutput();
  const code = await runArtifactDecide(SPEC_PATH, { verdicts: "verdicts.json" }, o.out, {
    backendLayer: backend.layer,
    terminalLayer: makeFakeTerminal(true).layer,
    githubLayer: makeFakeGitHub().layer,
  });
  return { code, errors: o.errors };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a failed session's terminal report", { timeout: 30_000 }, () => {
  it("the DNS outage prints the failure, the session, the files and the retry, then exits 14", async () => {
    const failure = dnsOutage(true);

    const { code, errors } = await decideWith(failure, {
      agentErrorLog: "/runs/r/decide/01/agent-error.log",
      transcript: "/runs/r/decide/01/output.jsonl",
    });

    expect(code).toBe(14);
    expect(errors).toEqual([
      `✗ claude-code session failed (network): ${API_ERROR}`,
      `  session: ${SESSION}`,
      "  See /runs/r/decide/01/agent-error.log and output.jsonl",
      `  Retry once the network is back: phax artifact decide ${SPEC_PATH} --verdicts verdicts.json`,
    ]);
  });

  it("a failure with no session id still names its agent-error.log and transcript", async () => {
    const failure = dnsOutage(false);
    expect(failure.sessionId).toBeNull();

    const { code, errors } = await decideWith(failure, {
      agentErrorLog: "/runs/r/decide/01/agent-error.log",
      transcript: "/store/transcript.jsonl",
    });

    expect(code).toBe(14);
    expect(errors.join("\n")).not.toContain("session:");
    expect(errors).toContain("  See /runs/r/decide/01/agent-error.log and /store/transcript.jsonl");
  });

  it("a non-network failure exits 5 with no retry hint", async () => {
    const failure: SessionFailure = { ...dnsOutage(true), kind: "provider-error" };

    const { code, errors } = await decideWith(failure, { agentErrorLog: null, transcript: null });

    expect(code).toBe(5);
    expect(errors).toEqual([
      `✗ claude-code session failed (provider-error): ${API_ERROR}`,
      `  session: ${SESSION}`,
    ]);
  });
});
