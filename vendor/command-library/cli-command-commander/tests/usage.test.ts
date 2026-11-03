import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { afterAll, describe, expect, it } from "vitest";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
  usageSpec,
} from "@steme-lab/cli-command";
import { call } from "./support/memory-io.ts";

const Str = Schema.String;

const show = defineCommand({
  name: "show",
  summary: "Show a todo",
  help: "Shows one todo, with its history.\nIt reads nothing else.",
  examples: ["todos show t1", "todos show t1 --mode b --json"],
  input: {
    args: reject(
      Schema.Tuple([
        Str.annotate({ identifier: "id", description: "The todo's id" }),
      ]),
    ),
    flags: reject(
      Schema.Struct({
        mode: Schema.optionalKey(
          Schema.Literals(["a", "b"]).annotate({ description: "The mode" }),
        ),
        level: Str.annotate({ description: "How loud" }).pipe(
          Schema.withDecodingDefaultKey(Effect.succeed("low")),
        ),
        dryRun: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  },
  output: strip(Schema.Struct({ id: Str })),
  exits: {},
  run: () => Effect.succeed({ id: "t1" }),
  render: (value) => value.id,
});

const accept = defineCommand({
  name: "accept",
  summary: "Accept a debt",
  input: { args: reject(Schema.Tuple([Str])) },
  output: strip(Str),
  exits: {},
  run: () => Effect.succeed("accepted"),
  render: (text) => text,
});

const list = defineCommand({
  name: "list",
  summary: "List the debt",
  input: {},
  output: strip(Str),
  exits: {},
  run: () => Effect.succeed("listed"),
  render: (text) => text,
});

const program = defineProgram({
  name: "todos",
  version: "2.0.0",
  exits: { refused: 3, defect: 70 },
  commands: [
    show,
    defineGroup({
      name: "debt",
      summary: "Accept debt, or list it",
      commands: [accept, list],
    }),
  ],
});

interface Argument {
  readonly name: string;
  readonly required: boolean;
  readonly help?: string;
  readonly default?: ReadonlyArray<string>;
}
interface Flag {
  readonly name: string;
  readonly help?: string;
  readonly default?: ReadonlyArray<string>;
  readonly arg?: { readonly choices?: { readonly choices: string[] } };
}
interface Cmd {
  readonly name?: string;
  readonly subcommands: Record<string, Cmd>;
  readonly args: ReadonlyArray<Argument>;
  readonly flags: ReadonlyArray<Flag>;
  readonly help?: string;
  readonly help_long?: string;
  readonly subcommand_required?: boolean;
  readonly examples: ReadonlyArray<{ readonly code: string }>;
}

const directory = mkdtempSync(join(tmpdir(), "cli-command-usage-"));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** The spec, parsed by the `usage` CLI itself: what its `generate json` says of it. */
function parsedByUsage(spec: string): {
  readonly cmd: Cmd;
  readonly bin: string;
} {
  const file = join(directory, "todos.usage.kdl");
  writeFileSync(file, spec);
  const json = execFileSync("usage", ["generate", "json", "-f", file], {
    encoding: "utf8",
  });
  return JSON.parse(json) as { cmd: Cmd; bin: string };
}

describe("the usage spec", () => {
  it("is what the runner answers on --usage-spec, and nothing else is run or read", async () => {
    const result = await call(program, { argv: ["--usage-spec"] });
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out.join("")).toBe(usageSpec(program));
    expect(result.stdinReads()).toBe(0);
  });

  it("parses with the usage CLI, and says the program, its commands and its group", async () => {
    const spec = (await call(program, { argv: ["--usage-spec"] })).out.join("");
    const parsed = parsedByUsage(spec);
    expect(parsed.bin).toBe("todos");
    expect(Object.keys(parsed.cmd.subcommands)).toEqual(["show", "debt"]);
    const debt = parsed.cmd.subcommands["debt"];
    expect(debt?.subcommand_required).toBe(true);
    expect(debt?.help).toBe("Accept debt, or list it");
    expect(Object.keys(debt?.subcommands ?? {})).toEqual(["accept", "list"]);
  });

  it("names the positional by its identifier, never arg0, and gives its help", async () => {
    const spec = (await call(program, { argv: ["--usage-spec"] })).out.join("");
    const shown = parsedByUsage(spec).cmd.subcommands["show"];
    expect(shown?.args.map((arg) => arg.name)).toEqual(["id"]);
    expect(shown?.args[0]?.help).toBe("The todo's id");
    // the group's commands have no annotation to name theirs
    const accepted =
      parsedByUsage(spec).cmd.subcommands["debt"]?.subcommands["accept"];
    expect(accepted?.args.map((arg) => arg.name)).toEqual(["arg0"]);
  });

  it("gives an option's default, its help and a literal union's choices", async () => {
    const spec = (await call(program, { argv: ["--usage-spec"] })).out.join("");
    const flags = parsedByUsage(spec).cmd.subcommands["show"]?.flags ?? [];
    const level = flags.find((flag) => flag.name === "level");
    expect(level?.default).toEqual(["low"]);
    expect(level?.help).toBe("How loud");
    const mode = flags.find((flag) => flag.name === "mode");
    expect(mode?.help).toBe("The mode");
    expect(mode?.arg?.choices?.choices).toEqual(["a", "b"]);
    expect(flags.some((flag) => flag.name === "dry-run")).toBe(true);
  });

  it("carries a command's long help and its examples", async () => {
    const spec = (await call(program, { argv: ["--usage-spec"] })).out.join("");
    const shown = parsedByUsage(spec).cmd.subcommands["show"];
    expect(shown?.help).toBe("Show a todo");
    expect(shown?.help_long).toBe(
      "Shows one todo, with its history.\nIt reads nothing else.",
    );
    expect(shown?.examples.map((each) => each.code)).toEqual([
      "todos show t1",
      "todos show t1 --mode b --json",
    ]);
  });

  it("declares --json and --json-schema on every command, grouped or not", async () => {
    const spec = (await call(program, { argv: ["--usage-spec"] })).out.join("");
    const { cmd } = parsedByUsage(spec);
    const debt = cmd.subcommands["debt"];
    const commands = [
      cmd.subcommands["show"],
      debt?.subcommands["accept"],
      debt?.subcommands["list"],
    ];
    for (const command of commands) {
      const names = command?.flags.map((flag) => flag.name) ?? [];
      expect(names).toContain("json");
      expect(names).toContain("json-schema");
    }
    // the program's own --json-schema, and its hidden --usage-spec
    expect(cmd.flags.map((flag) => flag.name)).toEqual([
      "usage-spec",
      "json-schema",
    ]);
  });

  it("shows the same names, help, choices and default on --help, and enforces none of them", async () => {
    const help = await call(program, { argv: ["show", "--help"] });
    expect(help.code).toBe(0);
    const text = help.out.join("");
    for (const shown of [
      "<id>",
      "The todo's id",
      "The mode",
      '(choices: "a", "b")',
      "How loud",
      '(default: "low")',
      "Shows one todo, with its history.",
      "Examples:",
      "todos show t1 --mode b --json",
    ]) {
      expect(text).toContain(shown);
    }
    // a choice is the contract's to refuse, and a default the contract's to give: Commander's
    // help shows them, and its parse does neither
    const outside = await call(program, {
      argv: ["show", "t1", "--mode", "z"],
    });
    expect(outside.code).toBe(3);
    expect(outside.err.join("")).toContain("flags does not decode");
    const defaulted = await call(program, { argv: ["show", "t1", "--json"] });
    expect(defaulted.code).toBe(0);
  });

  it("names the positional in the catalogue, and in a refusal", async () => {
    const entry = await call(program, { argv: ["show", "--json-schema"] });
    const contract = JSON.parse(entry.out.join("")) as {
      input: { properties: Record<string, unknown>; required: string[] };
    };
    expect(Object.keys(contract.input.properties)).toContain("id");
    expect(contract.input.required).toContain("id");

    const missing = await call(program, { argv: ["show", "--json"] });
    expect(missing.code).toBe(3);
    expect(missing.err.join("")).toContain('"path":["id"]');
  });

  it("is written from the definitions: the same program gives the same spec", () => {
    expect(usageSpec(program)).toBe(usageSpec(program));
    expect(
      usageSpec(program).startsWith('name todos\nbin todos\nversion "2.0.0"\n'),
    ).toBe(true);
  });
});
