import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerResumeCommand } from "../../src/cli/commands/resumeRegister.js";
import type { OutputPort } from "../../src/ports/output.js";

function makeProgram() {
  const p = new Command();
  p.exitOverride(); // prevent commander from calling process.exit on errors
  p.option("--verbose", "Print human-readable progress and system events");
  p.option("--trace", "Write structured JSONL trace events to the run folder");
  return p;
}

const noopOut: OutputPort = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

describe("resume subcommand argv parsing", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  async function parseAndCapture(argv: string[]) {
    const runResumeImpl = vi.fn().mockResolvedValue(0);
    const p = makeProgram();
    registerResumeCommand(p, runResumeImpl, noopOut, () => {
      const g = p.opts<{ verbose?: boolean; trace?: boolean }>();
      const result: { verbose?: boolean; trace?: boolean } = {};
      if (g.verbose !== undefined) result.verbose = g.verbose;
      if (g.trace !== undefined) result.trace = g.trace;
      return result;
    });
    await p.parseAsync(["node", "phax", ...argv]);
    return runResumeImpl;
  }

  it("passes --yes", async () => {
    const spy = await parseAndCapture(["resume", "foo", "--yes"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toMatchObject({ yes: true });
  });

  it("passes -y short alias", async () => {
    const spy = await parseAndCapture(["resume", "foo", "-y"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toMatchObject({ yes: true });
  });

  it("passes --yes --verbose --trace together", async () => {
    const spy = await parseAndCapture(["resume", "foo", "--yes", "--verbose", "--trace"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toMatchObject({ yes: true, verbose: true, trace: true });
  });

  it("merges global --verbose with subcommand --yes", async () => {
    const spy = await parseAndCapture(["--verbose", "resume", "foo", "--yes"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1]).toMatchObject({ yes: true, verbose: true });
  });

  it("calls runResume without yes when no flags given", async () => {
    const spy = await parseAndCapture(["resume", "foo"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][1].yes).toBeUndefined();
  });
});
