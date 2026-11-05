// What `phax run` and `phax resume` answer on the command runner, through the definition
// factories over the runner's memory Io with fake layers: acceptance tests of the spec
// command-contracts (ac-error-sentence's resume case, ac-progress, ac-json-every-command,
// ac-text-unchanged). The factories are stubs until the plan's phase-05 moves the commands, so
// every test is an expected failure until then.
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../src/cli/commandLibrary/commander/index.js";
import { memoryIo } from "../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import type { ExitCode } from "../../src/cli/commandLibrary/contract/index.js";
import { makeResumeCommand } from "../../src/cli/definitions/resume.js";
import { makeRunCommand } from "../../src/cli/definitions/run.js";
import { makeRunCommandsRepo, type RunCommandsRepo } from "../fixtures/run/runCommandsRepo.js";

// A temporary home for the modules that compute their ~/.phax paths at import.
vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

let repo: RunCommandsRepo;
beforeEach(async () => {
  repo = await makeRunCommandsRepo();
  vi.spyOn(process, "cwd").mockReturnValue(repo.repoDir);
});
afterEach(() => {
  vi.restoreAllMocks();
  repo.dispose();
});

const splitLines = (text: string): string[] =>
  text === "" ? [] : text.replace(/\n$/, "").split("\n");

/** One call of `argv` against a program holding the factories' commands, over the memory Io. */
async function call(argv: ReadonlyArray<string>, fakes = repo.fakes()) {
  const program = repo.program([makeRunCommand(fakes.deps), makeResumeCommand(fakes.deps)]);
  const memory = memoryIo({ argv });
  const code = await Effect.runPromise(runner.run(program, memory.io) as Effect.Effect<ExitCode>);
  return {
    code,
    out: memory.out(),
    err: memory.err(),
    errLines: splitLines(memory.err()),
    writes: memory.writes(),
  };
}

/** Every stderr line of a --json call, parsed: a message line is a JSON object with a `kind`. */
const parsed = (errLines: ReadonlyArray<string>): Array<Record<string, unknown>> =>
  errLines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("phax run and phax resume on the runner", () => {
  // ac-error-sentence
  it("resume --yes on a run locked by a live process answers with today's sentence, exit 7", async () => {
    const result = await call(["resume", repo.runShortName, "--yes"]);
    expect(result.err).toBe(
      `phax resume failed: Run "${repo.runQualifiedName}" is locked by pid ${repo.pid}\n`,
    );
    expect(result.code).toBe(7);
  });

  // ac-error-sentence
  it("resume --yes --json on a locked run writes the spec's error line, exit 7", async () => {
    const result = await call(["resume", repo.runShortName, "--yes", "--json"]);
    expect(result.code).toBe(7);
    const lines = parsed(result.errLines);
    const errors = lines.filter((line) => line["kind"] === "error");
    expect(errors).toEqual([
      {
        kind: "error",
        error: "LockConflictError",
        exit: 7,
        fields: { run: repo.runShortName, pid: repo.pid },
        written: [],
      },
    ]);
    expect(
      lines.filter((line) => line["kind"] !== "error").every((line) => line["kind"] === "note"),
    ).toBe(true);
  });

  // ac-progress
  it("run --dry-run --json writes its progress as notes on stderr before the one answer", async () => {
    const fakes = repo.fakes();
    const first = await call(["run", "--plan", repo.planPath, "--dry-run"], fakes);
    expect(first.code).toBe(0);

    const second = await call(["run", "--plan", repo.planPath, "--dry-run", "--json"], fakes);
    expect(second.code).toBe(0);
    const note = JSON.stringify({ kind: "note", text: "using cached extraction" });
    expect(second.errLines).toContain(note);
    const noteAt = second.writes.findIndex(
      (write) => write.stream === "err" && write.text.includes(note),
    );
    const answerAt = second.writes.findIndex((write) => write.stream === "out");
    expect(noteAt).toBeGreaterThanOrEqual(0);
    expect(answerAt).toBeGreaterThan(noteAt);

    const answer = JSON.parse(second.out) as { outcome: { kind: string } };
    expect(second.out).toBe(`${JSON.stringify(answer, null, 2)}\n`);
    expect(answer.outcome.kind).toBe("dry-run");
  });

  // ac-json-every-command
  it("resume --json without --yes answers its preview and takes no lock", async () => {
    const lockBefore = repo.readLock();
    const result = await call(["resume", repo.runShortName, "--json"]);
    expect(result.code).toBe(0);
    const answer = JSON.parse(result.out) as {
      outcome: { kind: string; nextPhaseId: string };
    };
    expect(result.out).toBe(`${JSON.stringify(answer, null, 2)}\n`);
    expect(answer.outcome.kind).toBe("preview");
    expect(answer.outcome.nextPhaseId).toBe(repo.nextPhaseId);
    expect(parsed(result.errLines).every((line) => line["kind"] === "note")).toBe(true);
    expect(repo.readLock()).toBe(lockBefore);
    expect(JSON.parse(repo.readLock())).toMatchObject({ pid: repo.pid });
  });

  // ac-text-unchanged
  it("run --dry-run without --json prints today's report on stdout", async () => {
    const fakes = repo.fakes();
    const first = await call(["run", "--plan", repo.planPath, "--dry-run"], fakes);
    expect(first.code).toBe(0);
    const worktrees = `${repo.stateRoot}/worktrees/made-up.dry-run-plan/phase-01`;
    const expected = [
      "Dry run: made-up.dry-run-plan",
      "  Branch:       phax/dry-run-plan",
      "  Project:      made-up",
      "  Gate profile: fast",
      "  Security:     secure",
      `  Run path:     ${repo.stateRoot}/runs/made-up.dry-run-plan`,
      "",
      "Hold: none",
      "",
      "Setup commands:",
      "  (none)",
      "",
      "Gate commands:",
      "  $ true",
      "",
      "Agent commands (security.agentCommands):",
      "  (none)",
      "",
      "Required commands (plan.run.requiredCommands):",
      "  (none)",
      "",
      "Cleanup commands:",
      "  (none)",
      "",
      "Phases (1 total):",
      "  [1] phase-01 — First Phase (claude-sonnet-4-6, medium)",
      `       worktree: ${worktrees}`,
      "",
    ].join("\n");
    expect(first.out).toBe(expected);
  });
});
