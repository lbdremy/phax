// How the runner reads `phax resume`'s words: the resume definition's input, with its run swapped
// for a spy, through tests/helpers/runnerCall.ts over the memory Io. The program's `--verbose` and
// `--trace` are phaxProgram's options, read wherever they stand in the call.
import { Effect, Predicate } from "effect";
import { describe, expect, it } from "vitest";
import type { Command } from "../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../src/cli/definitions/program.js";
import { makeResumeCommand } from "../../src/cli/definitions/resume.js";
import type { RunAnswer } from "../../src/cli/definitions/runOutcome.js";
import { runnerCall } from "../helpers/runnerCall.js";

interface Seen {
  readonly args: ReadonlyArray<string>;
  readonly flags: Readonly<Record<string, unknown>>;
  readonly program: Readonly<Record<string, unknown>>;
}

const PREVIEW: RunAnswer = {
  qualifiedName: "ns.foo",
  crossProject: false,
  outcome: {
    kind: "preview",
    fromState: "interrupted",
    nextPhaseId: "phase-01",
    nextPhaseIndex: 0,
    skippedPhaseIds: [],
    owedStep: "none",
    skipAcceptance: false,
  },
};

/** The resume definition, its run a spy that records what the runner decoded. */
function spiedResume(): { readonly command: Command<never>; readonly seen: Seen[] } {
  const seen: Seen[] = [];
  const command: Command<never> = {
    ...makeResumeCommand(),
    run: ({ input, program }) =>
      Effect.sync(() => {
        // A runner-erased command reads its decoded input as unknown values.
        const args = input["args"];
        const flags = input["flags"];
        if (!Array.isArray(args) || !Predicate.isReadonlyObject(flags)) {
          throw new Error("the runner decoded no args array or flags object");
        }
        seen.push({ args, flags, program });
        return PREVIEW;
      }),
  };
  return { command, seen };
}

async function parseAndCapture(argv: string[]) {
  const { command, seen } = spiedResume();
  const result = await runnerCall([command], argv, { programOptions: phaxProgram.options });
  return { result, seen };
}

describe("resume subcommand argv parsing", () => {
  it("passes --yes", async () => {
    const { seen } = await parseAndCapture(["resume", "foo", "--yes"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags).toMatchObject({ yes: true });
  });

  it("passes -y short alias", async () => {
    const { seen } = await parseAndCapture(["resume", "foo", "-y"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags).toMatchObject({ yes: true });
  });

  it("passes --yes --verbose --trace together", async () => {
    const { seen } = await parseAndCapture(["resume", "foo", "--yes", "--verbose", "--trace"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags).toMatchObject({ yes: true });
    expect(seen[0]?.program).toMatchObject({ verbose: true, trace: true });
  });

  it("merges global --verbose with subcommand --yes", async () => {
    const { seen } = await parseAndCapture(["--verbose", "resume", "foo", "--yes"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags).toMatchObject({ yes: true });
    expect(seen[0]?.program).toMatchObject({ verbose: true });
  });

  it("calls runResume without yes when no flags given", async () => {
    const { seen } = await parseAndCapture(["resume", "foo"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags["yes"]).toBeUndefined();
  });

  it("forwards --skip-acceptance to runResume", async () => {
    const { seen } = await parseAndCapture(["resume", "foo", "--yes", "--skip-acceptance"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags).toMatchObject({ yes: true, skipAcceptance: true });
    expect(seen[0]?.flags["skipOracle"]).toBeUndefined();
  });

  it("refuses the retired --skip-oracle with its sentence and 64, before anything runs", async () => {
    const { result, seen } = await parseAndCapture(["resume", "foo", "--yes", "--skip-oracle"]);
    expect(seen).toHaveLength(0);
    expect(result.code).toBe(64);
    expect(result.errLines[0]).toBe("--skip-oracle is no longer read: write --skip-acceptance");
  });

  it("lists --skip-acceptance in help and never the retired --skip-oracle", async () => {
    const { result } = await parseAndCapture(["resume", "--help"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("--skip-acceptance");
    expect(result.out).not.toContain("--skip-oracle");
  });

  it("forwards --provider-priority to runResume", async () => {
    const { seen } = await parseAndCapture([
      "resume",
      "foo",
      "--provider-priority",
      "codex-cli,claude-code",
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.flags).toMatchObject({ providerPriority: "codex-cli,claude-code" });
  });

  it("passes a bare short name as-is", async () => {
    const { seen } = await parseAndCapture(["resume", "my-run"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.args[0]).toBe("my-run");
  });

  it("passes a qualified name as-is", async () => {
    const { seen } = await parseAndCapture(["resume", "mynamespace.my-run"]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.args[0]).toBe("mynamespace.my-run");
  });
});
