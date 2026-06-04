import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import type { OutputPort } from "../../src/ports/output.js";

const noopOut: OutputPort = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

describe("run subcommand argv parsing", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  async function parseAndCapture(argv: string[]) {
    const runRunImpl = vi.fn().mockResolvedValue(0);
    const p = new Command();
    p.exitOverride();
    p.option("--verbose", "Print human-readable progress and system events");
    p.option("--trace", "Write structured JSONL trace events to the run folder");

    function globalTraceOpts(): { verbose?: boolean; trace?: boolean } {
      const g = p.opts<{ verbose?: boolean; trace?: boolean }>();
      const result: { verbose?: boolean; trace?: boolean } = {};
      if (g.verbose !== undefined) result.verbose = g.verbose;
      if (g.trace !== undefined) result.trace = g.trace;
      return result;
    }

    p.command("run [short-name]")
      .option("--plan-md <path>", "Path to plan.md")
      .option("--profile <profile>", "Gate profile to use")
      .option("--workspace <id>", "Workspace id")
      .option("--allow-dirty", "Allow starting when the working tree is dirty")
      .option(
        "--provider-priority <list>",
        "Comma-separated provider priority override (e.g. mistral-vibe,claude-code)",
      )
      .option("--dry-run", "Preview only")
      .option(
        "--security <mode>",
        "Security mode override (secure|unsafe|isolated, overrides config default)",
      )
      .action(
        async (
          shortName: string | undefined,
          opts: {
            planMd?: string;
            profile?: string;
            workspace?: string;
            allowDirty?: boolean;
            providerPriority?: string;
            dryRun?: boolean;
            security?: string;
          },
        ) => {
          const merged = { ...opts, ...globalTraceOpts() };
          const exitCode = await runRunImpl(
            shortName !== undefined ? { shortName, ...merged } : merged,
            noopOut,
          );
          process.exit(exitCode);
        },
      );

    await p.parseAsync(["node", "phax", ...argv]);
    return runRunImpl;
  }

  it("passes --provider-priority as a raw string", async () => {
    const spy = await parseAndCapture([
      "run",
      "foo",
      "--provider-priority",
      "mistral-vibe,claude-code",
    ]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      shortName: "foo",
      providerPriority: "mistral-vibe,claude-code",
    });
  });

  it("omits providerPriority when flag is not given", async () => {
    const spy = await parseAndCapture(["run", "foo"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].providerPriority).toBeUndefined();
  });

  it("combines --provider-priority with --dry-run", async () => {
    const spy = await parseAndCapture(["run", "--provider-priority", "codex-cli", "--dry-run"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      providerPriority: "codex-cli",
      dryRun: true,
    });
  });

  it("merges global --verbose with --provider-priority", async () => {
    const spy = await parseAndCapture([
      "--verbose",
      "run",
      "bar",
      "--provider-priority",
      "claude-code",
    ]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      shortName: "bar",
      providerPriority: "claude-code",
      verbose: true,
    });
  });

  it("passes --security flag to runRun", async () => {
    const spy = await parseAndCapture(["run", "foo", "--security", "unsafe"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      shortName: "foo",
      security: "unsafe",
    });
  });

  it("passes --security secure", async () => {
    const spy = await parseAndCapture(["run", "--security", "secure", "--dry-run"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      security: "secure",
      dryRun: true,
    });
  });

  it("passes --security isolated", async () => {
    const spy = await parseAndCapture(["run", "--security", "isolated", "--dry-run"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toMatchObject({
      security: "isolated",
      dryRun: true,
    });
  });

  it("omits security when flag is not given", async () => {
    const spy = await parseAndCapture(["run", "foo"]);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0].security).toBeUndefined();
  });
});
