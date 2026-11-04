// One contract test over every command and every whole group of phaxProgram, through the runner
// and the memory Io: no command is run. Each command that joins phaxProgram is covered here as it
// moves (command-contracts plan 2): `--json-schema` prints its catalogue entry, `--help` lists
// `--json`, an undeclared option is refused with 64 (a `refused` line from the flags under
// `--json`), and a group the runner holds whole, called alone, writes its help and is refused.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { PARTIAL_GROUPS } from "../../../src/cli/bridge.js";
import { runner } from "../../../src/cli/commandLibrary/commander/index.js";
import {
  argShapes,
  fullName,
  usageSpec,
  type Command,
  type ExitCode,
  type Inputs,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../../src/cli/definitions/program.js";
import { disableGitAutoMaintenance, removeTempDir } from "../../helpers/tempGit.js";
import { memoryIo } from "../commandLibrary/commander/support/memoryIo.js";

interface Called {
  readonly code: ExitCode;
  readonly out: string;
  readonly err: string;
}

async function call(argv: ReadonlyArray<string>): Promise<Called> {
  const memory = memoryIo({ argv });
  const code = await Effect.runPromise(
    runner.run(phaxProgram, memory.io) as Effect.Effect<ExitCode>,
  );
  return { code, out: memory.out.join(""), err: memory.err.join("") };
}

/** A value for each required argument, so that a refusal is the option's: the first choice of
 *  a literal union, else `x`; one value for a required variadic argument. */
function placeholders(command: Command<unknown>): ReadonlyArray<string> {
  const inputs: Inputs = command.input;
  if (inputs.args === undefined) return [];
  return argShapes(inputs.args.contract)
    .filter((arg) => !arg.optional)
    .map((arg) => arg.choices?.[0] ?? "x");
}

const commands = phaxProgram.commands.map((command) => ({
  command,
  words: fullName(command),
  label: fullName(command).join(" "),
}));

/** The groups the runner holds whole, nested ones by their full words. */
const wholeGroups: ReadonlyArray<ReadonlyArray<string>> = [
  ...new Map(
    phaxProgram.commands.flatMap((command) => {
      const name = fullName(command);
      if (PARTIAL_GROUPS.includes(name[0] ?? "")) return [];
      return name
        .slice(0, -1)
        .map((_, index) => name.slice(0, index + 1))
        .map((words) => [words.join(" "), words] as const);
    }),
  ).values(),
];

const catalogue = JSON.parse((await call(["--json-schema"])).out) as {
  readonly commands: ReadonlyArray<{ readonly name: ReadonlyArray<string> }>;
};

describe("the catalogue of phaxProgram", () => {
  it("holds exactly one entry per command of the program, in its order", () => {
    expect(catalogue.commands.map((entry) => entry.name.join(" "))).toEqual(
      commands.map((each) => each.label),
    );
    expect(new Set(commands.map((each) => each.label)).size).toBe(commands.length);
  });
});

describe.each(commands)("phax $label", ({ command, words, label }) => {
  it("prints its catalogue entry on --json-schema, and runs nothing", async () => {
    const called = await call([...words, "--json-schema"]);
    expect(called.code).toBe(0);
    expect(called.err).toBe("");
    expect(called.out.endsWith("\n")).toBe(true);
    const entry = catalogue.commands.find((each) => each.name.join(" ") === label);
    expect(JSON.parse(called.out)).toEqual(entry);
  });

  it("answers --help with 0, listing --json", async () => {
    const called = await call([...words, "--help"]);
    expect(called.code).toBe(0);
    expect(called.out).toContain("--json");
  });

  it("refuses an undeclared option under --json with one refused line from the flags", async () => {
    const called = await call([...words, ...placeholders(command), "--colour", "--json"]);
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    const lines = called.err.split("\n").filter((each) => each !== "");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      kind: "refused",
      source: "flags",
      path: ["colour"],
      exit: 64,
    });
  });

  it("refuses an undeclared option with 64 and the unknown-option text", async () => {
    const called = await call([...words, ...placeholders(command), "--colour"]);
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    expect(called.err.startsWith("error: unknown option '--colour'")).toBe(true);
  });
});

describe("the groups the runner holds whole", () => {
  // None is held whole until phase-02 removes `plans` from PARTIAL_GROUPS; each joins as it moves.
  it("each, called alone, writes its help on stderr and is refused with 64", async () => {
    for (const words of wholeGroups) {
      const called = await call(words);
      expect(called.code, words.join(" ")).toBe(64);
      expect(called.out, words.join(" ")).toBe("");
      expect(called.err, words.join(" ")).toContain("Usage:");
    }
  });

  // ac-groups: `artifact` and `artifact new` were the last partial groups of the runner's.
  it("holds artifact and artifact new whole, PARTIAL_GROUPS empty", () => {
    expect(PARTIAL_GROUPS).toEqual([]);
    const labels = wholeGroups.map((words) => words.join(" "));
    expect(labels).toContain("artifact");
    expect(labels).toContain("artifact new");
  });
});

describe("the retired phax artifact archive", () => {
  const SENTENCE =
    'unknown transition "archive" — the completion transition is: phax artifact complete <path>';

  it("is refused with today's sentence and 64, running nothing", async () => {
    const called = await call(["artifact", "archive", "docs/specs/2609091412-plan-prune.md"]);
    expect(called.code).toBe(64);
    expect(called.out).toBe("");
    expect(called.err).toContain(SENTENCE);
  });

  it("is one refused line from the command under --json", async () => {
    const called = await call(["artifact", "archive", "x", "--json"]);
    expect(called.code).toBe(64);
    const lines = called.err.split("\n").filter((each) => each !== "");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      kind: "refused",
      source: "command",
      text: SENTENCE,
      exit: 64,
    });
  });

  it("is absent from the group's help and from the runner's usage spec", async () => {
    const help = await call(["artifact", "--help"]);
    expect(help.out).not.toMatch(/^\s+archive\b/m);
    expect(usageSpec(phaxProgram)).not.toMatch(/^\s+cmd "?archive"?/m);
  });
});

describe("phax artifact new spec, in the whole group", () => {
  it("still creates a blank Draft spec", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "phax-new-spec-")));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(repo);
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      disableGitAutoMaintenance(repo);
      const called = await call(["artifact", "new", "spec", "plan-prune"]);
      expect(called.err).toBe("");
      expect(called.code).toBe(0);
      expect(called.out).toMatch(/^created docs\/specs\/\d{10}-plan-prune\.md \(Draft\)\n$/);
      const path = called.out.slice("created ".length, -" (Draft)\n".length);
      expect(readFileSync(join(repo, path), "utf8")).toContain("status: Draft");
    } finally {
      cwd.mockRestore();
      removeTempDir(repo);
    }
  });
});
