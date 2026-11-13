import { afterEach, describe, expect, it, vi } from "vitest";
import { makeArtifactReviseCommand } from "../../src/cli/definitions/artifactRevise.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { makeFakeTerminal } from "../../src/infra/fakes/terminal.js";
import { AMENDMENT, useReviseRepo } from "../helpers/reviseHarness.js";
import { inArtifact, runnerCall, type RunnerCallOptions } from "../helpers/runnerCall.js";
import {
  PLAN_ANSWER_REVISED,
  PLAN_ANSWER_UNCHANGED,
  REVISE_PLAN_PATH,
  REVISE_PLAN_SIDECAR,
} from "../unit/revise/reviseFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// `phax artifact revise` end to end in a temp repo, through the command runner over a memory Io:
// real git and filesystem, a fake writer backend, a fake terminal. Every artifact is made up.

const world = useReviseRepo();

function seedPlan(status: "Draft" | "Approved" = "Draft"): void {
  world.writeRepoFile(
    "phax.json",
    JSON.stringify({
      version: 1,
      name: "made-up",
      gateProfiles: { fast: [{ command: "true", surface: "local", firing: "every-phase" }] },
    }),
  );
  world.seed({ kind: "plan", status, kept: false });
}

function deps(answers: readonly unknown[]) {
  const backend = makeFakeBackend();
  for (const answer of answers) {
    backend.impl.addRunResponse({
      sessionId: "7d3e9b10-aaaa-4bbb-8ccc-0123456789ab" as ClaudeSessionId,
      outputPath: "",
      finalText: JSON.stringify(answer),
    });
  }
  return {
    backend: backend.impl,
    deps: {
      backendLayer: backend.layer,
      terminalLayer: makeFakeTerminal(true).layer,
      githubLayer: makeFakeGitHub().layer,
    },
  };
}

function revise(
  d: ReturnType<typeof deps>["deps"],
  rest: ReadonlyArray<string>,
  options: RunnerCallOptions = {},
) {
  return runnerCall(
    [inArtifact(makeArtifactReviseCommand(d))],
    ["artifact", "revise", REVISE_PLAN_PATH, ...rest],
    { files: { "amendment.md": AMENDMENT }, ...options },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("phax artifact revise", { timeout: 30_000 }, () => {
  it("--json: stdout is one object with the fourteen report keys, progress on stderr", async () => {
    seedPlan();
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps([PLAN_ANSWER_REVISED]);

    const called = await revise(d, ["--amendment", "amendment.md", "--by", "operator", "--json"]);

    expect(called.code).toBe(0);
    expect(backend.runCalls).toHaveLength(1);
    const report = JSON.parse(called.out) as Record<string, unknown>;
    expect(Object.keys(report)).toEqual([
      "artifact",
      "status",
      "session",
      "provider",
      "model",
      "requestedModel",
      "effort",
      "newQuestions",
      "openQuestions",
      "diff",
      "commit",
      "revisionId",
      "written",
      "record",
    ]);
    expect(report["artifact"]).toBe(REVISE_PLAN_PATH);
    expect(report["status"]).toBe("Draft");
    expect(report["openQuestions"]).toEqual(["Q1", "Q2"]);
    expect(JSON.stringify(report["written"])).toContain(REVISE_PLAN_SIDECAR);
    expect(JSON.stringify(report["written"])).toContain(REVISE_PLAN_PATH);
    expect(called.err).toContain("amendment from amendment.md");
  });

  it("--amendment - with a terminal on stdin exits 64 before any session", async () => {
    seedPlan();
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps([PLAN_ANSWER_REVISED]);

    const called = await revise(d, ["--amendment", "-", "--by", "operator"], {
      stdinIsTerminal: true,
    });

    expect(called.code).toBe(64);
    expect(backend.runCalls).toHaveLength(0);
  });

  it("an empty amendment file exits 64 before any session", async () => {
    seedPlan();
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps([PLAN_ANSWER_REVISED]);

    const called = await revise(d, ["--amendment", "empty.md", "--by", "operator"], {
      files: { "empty.md": "  \n" },
    });

    expect(called.code).toBe(64);
    expect(backend.runCalls).toHaveLength(0);
  });

  it("an unchanged answer exits 0, says nothing changed and leaves HEAD as it was", async () => {
    seedPlan();
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const head = world.headSha();
    const { deps: d } = deps([PLAN_ANSWER_UNCHANGED]);

    const called = await revise(d, ["--amendment", "amendment.md", "--by", "operator"]);

    expect(called.code).toBe(0);
    expect(called.out).toContain(
      `nothing changed: the amendment changed nothing in ${REVISE_PLAN_PATH} — no commit`,
    );
    expect(called.out).toContain(
      `status     Draft — unchanged; \`phax artifact decide ${REVISE_PLAN_PATH}\` (Q1, Q2 open), then \`phax artifact approve ${REVISE_PLAN_PATH}\``,
    );
    expect(called.out).not.toContain("read the diff above");
    expect(world.headSha()).toBe(head);
  });

  it("a revision that adds no question names the questions still open before approve", async () => {
    seedPlan();
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { deps: d } = deps([PLAN_ANSWER_REVISED]);

    const called = await revise(d, ["--amendment", "amendment.md", "--by", "operator"]);

    expect(called.code).toBe(0);
    expect(called.out).toContain("questions  none new");
    expect(called.out).toContain(
      `status     Draft — read the diff above, then \`phax artifact decide ${REVISE_PLAN_PATH}\` (Q1, Q2 open), then \`phax artifact approve ${REVISE_PLAN_PATH}\``,
    );
  });

  it("an Approved plan exits 12 naming phax artifact reopen", async () => {
    seedPlan("Approved");
    vi.spyOn(process, "cwd").mockReturnValue(world.repoDir);
    const { backend, deps: d } = deps([PLAN_ANSWER_REVISED]);

    const called = await revise(d, ["--amendment", "amendment.md", "--by", "operator"]);

    expect(called.code).toBe(12);
    expect(called.out + called.err).toContain("phax artifact reopen");
    expect(backend.runCalls).toHaveLength(0);
  });
});
