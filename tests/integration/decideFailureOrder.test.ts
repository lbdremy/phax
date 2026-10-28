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

// A failed decide whose record is refused: the cause prints first, the
// refusal after it says it follows the failed session and quotes gh, and the
// exit code is the cause's. Through `runArtifactDecide --verdicts`, with a
// fake backend failing the writer and a fake GitHub whose visibility fails.

const SPEC_JSON = SPEC_PATH.replace(/\.md$/, ".json");
const API_ERROR = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
const GH_LINE = "error connecting to api.github.com";
const world = useDecideRepo();

function networkFailure(): SessionFailure {
  const outcome = readClaudeOutcome({
    lines: [
      JSON.stringify({ type: "result", subtype: "success", is_error: true, result: API_ERROR }),
    ],
    stderr: "",
    end: { kind: "exited", code: 1 },
  });
  if (outcome.kind !== "failure") throw new Error("the outage must read as a failure");
  return outcome.failure;
}

function seed(): void {
  world.writeRepoFile(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
      records: { transcript: true, destination: { kind: "in-repo" }, autoPush: false },
    }),
  );
  world.writeRepoFile(SPEC_PATH, SPEC_FRONTMATTER + renderSpecBody(SPEC.document as SpecDocument));
  world.writeRepoFile(SPEC_JSON, serializeSidecar(SPEC));
  world.writeRepoFile("verdicts.json", FILE_VALID);
  world.commitAll();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a failed decide's cause and its refused record", { timeout: 30_000 }, () => {
  it("prints the failure line before the refusal that follows it, then exits with the cause's code", async () => {
    seed();
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const backend = makeFakeBackend();
    backend.impl.failRunWith(0, networkFailure(), {
      agentErrorLog: "/runs/r/decide/01/agent-error.log",
      transcript: "/runs/r/decide/01/output.jsonl",
    });
    const github = makeFakeGitHub();
    github.impl.failVisibility(GH_LINE);
    const printed: string[] = [];
    const out = {
      log: (m: string) => printed.push(m),
      warn: (m: string) => printed.push(`warn: ${m}`),
      error: (m: string) => printed.push(`error: ${m}`),
    };

    const code = await runArtifactDecide(SPEC_PATH, { verdicts: "verdicts.json" }, out, {
      backendLayer: backend.layer,
      terminalLayer: makeFakeTerminal(true).layer,
      githubLayer: github.layer,
    });

    expect(code).toBe(14);
    const failureAt = printed.findIndex((line) =>
      line.startsWith("error: ✗ claude-code session failed (network)"),
    );
    const refusalAt = printed.findIndex((line) =>
      line.startsWith("warn: decision record refused, following the failed session: "),
    );
    expect(failureAt).toBeGreaterThanOrEqual(0);
    expect(refusalAt).toBeGreaterThan(failureAt);
    expect(printed[refusalAt]).toContain(`gh: ${GH_LINE}`);
    expect(printed[refusalAt]).toContain("retry once the network is back");
    expect(printed[refusalAt]).not.toContain("acknowledgedUnknownVisibility");
    // Nothing ahead of the cause: the refusal was handed over, not printed.
    expect(printed.slice(0, failureAt).filter((line) => line.includes("record"))).toEqual([]);
  });
});
