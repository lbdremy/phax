import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { afterAll, describe, expect, it } from "vitest";
import {
  CompleterAnnotationId,
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
  usageSpec,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";

const Str = Schema.String;

const Id = Str.annotations({ identifier: "id", description: "The todo's id" });

const show = defineCommand({
  name: "show",
  summary: "Show a todo",
  help: "Shows one todo, with its history.\nIt reads nothing else.",
  examples: ["todos show t1", "todos show t1 --mode b --json"],
  input: {
    args: reject(Schema.Tuple(Id)),
    flags: reject(
      Schema.Struct({
        mode: Schema.optionalWith(
          Schema.Literal("a", "b").annotations({ description: "The mode" }),
          { exact: true },
        ),
        // Effect 3's decoding default: the key is optional on the command line, and the
        // contract gives `low` when it is absent.
        level: Schema.optionalWith(Str.annotations({ description: "How loud" }), {
          default: () => "low",
        }),
        dryRun: Schema.optionalWith(Schema.Boolean, { exact: true }),
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
  input: { args: reject(Schema.Tuple(Str)) },
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
    const accepted = parsedByUsage(spec).cmd.subcommands["debt"]?.subcommands["accept"];
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
    expect(shown?.help_long).toBe("Shows one todo, with its history.\nIt reads nothing else.");
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
    expect(cmd.flags.map((flag) => flag.name)).toEqual(["usage-spec", "json-schema"]);
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
    expect(usageSpec(program).startsWith('name todos\nbin todos\nversion "2.0.0"\n')).toBe(true);
  });
});

// Gains carried for upstream: the program's usage flag, `--json-schema` listed once, the
// program's options as global flags, completers and the program's exits.
describe("the usage spec of a program that names its usage flag", () => {
  const ShortName = Str.annotations({
    identifier: "short-name",
    description: "The run's short name",
    [CompleterAnnotationId]: { run: "todos ls --complete", descriptions: true },
  });
  const resume = defineCommand({
    name: "resume",
    summary: "Resume a run",
    input: { args: reject(Schema.Tuple(ShortName)) },
    output: strip(Str),
    exits: {},
    run: () => Effect.succeed("resumed"),
    render: (text) => text,
  });
  const named = defineProgram({
    name: "todos",
    version: "2.0.0",
    exits: { refused: 64, defect: 70 },
    usage: { flag: "usage", format: "usage-format", jsonSchema: "program" },
    options: reject(
      Schema.Struct({
        verbose: Schema.optionalWith(Schema.Boolean.annotations({ description: "Say more" }), {
          exact: true,
        }),
      }),
    ),
    commands: [
      resume,
      defineGroup({
        name: "plans",
        summary: "Work with plans",
        commands: [defineGroup({ name: "debt", summary: "Accept debt", commands: [accept] })],
      }),
    ],
  });

  it("is answered on the named flag, alone or with its format, in either order", async () => {
    const expected = usageSpec(named);
    for (const argv of [
      ["--usage"],
      ["--usage", "--usage-format", "kdl"],
      ["--usage", "--usage-format=kdl"],
      ["--usage-format", "kdl", "--usage"],
      ["--verbose", "--usage"],
    ]) {
      const result = await call(named, { argv });
      expect(result.code, argv.join(" ")).toBe(0);
      expect(result.out.join(""), argv.join(" ")).toBe(expected);
      expect(result.err, argv.join(" ")).toEqual([]);
    }
  });

  it("refuses another format, the format alone, a word beside the flag, and --usage-spec", async () => {
    for (const argv of [
      ["--usage", "--usage-format", "yaml"],
      ["--usage-format", "kdl"],
      ["--usage", "resume"],
      ["--usage-spec"],
    ]) {
      const result = await call(named, { argv: [...argv] });
      expect(result.code, argv.join(" ")).toBe(64);
      expect(result.out, argv.join(" ")).toEqual([]);
      expect(result.err.join(""), argv.join(" ")).toMatch(/^error: /);
    }
  });

  it("lists the flag, --json-schema once, the options as global flags, and the completers", () => {
    const spec = usageSpec(named);
    expect(spec).toContain(`flag --usage help="Print the usage spec, and run nothing"`);
    expect(spec).toContain(`flag "--usage-format <format>" help=`);
    expect(spec).toContain("flag --json-schema global=#true help=");
    expect(spec).toContain(`flag --verbose global=#true help="Say more"`);
    expect(spec).toContain(`complete "short-name" run="todos ls --complete" descriptions=#true`);
    expect(spec).toContain("64  refused");
    expect(spec).toContain("70  defect");
    expect(spec).not.toContain("--usage-spec");
    expect(spec.split("\n").filter((each) => each.includes("flag --json-schema"))).toHaveLength(1);
  });

  it("is read by the usage CLI, the nested group under its group", () => {
    const parsed = parsedByUsage(usageSpec(named));
    expect(parsed.bin).toBe("todos");
    const debt = parsed.cmd.subcommands["plans"]?.subcommands["debt"];
    expect(debt?.subcommand_required).toBe(true);
    expect(Object.keys(debt?.subcommands ?? {})).toEqual(["accept"]);
    expect(parsed.cmd.subcommands["resume"]?.args.map((each) => each.name)).toEqual(["short-name"]);
  });
});

// Gains carried for upstream: a group's long help and examples, and variadic arguments.
describe("the usage spec of a documented group and of variadic arguments", () => {
  const Plan = Str.annotations({ identifier: "plan", description: "A plan to compare" });
  const FilePath = Str.annotations({ identifier: "path", description: "A file to read" });
  const overlap = defineCommand({
    name: "overlap",
    summary: "Compare plans",
    input: { args: reject(Schema.NonEmptyArray(Plan)) },
    output: strip(Schema.Array(Str)),
    exits: {},
    run: ({ input }) => Effect.succeed(input.args),
  });
  const brief = defineCommand({
    name: "brief",
    summary: "Brief from files",
    input: { args: reject(Schema.Array(FilePath)) },
    output: strip(Schema.Array(Str)),
    exits: {},
    run: ({ input }) => Effect.succeed(input.args),
  });
  const documented = defineProgram({
    name: "todos",
    version: "1.0.0",
    exits: { refused: 2, defect: 70 },
    commands: [
      defineGroup({
        name: "plans",
        summary: "Work with plans",
        help: "Plans are read from the repository.\nNothing is written.",
        examples: ["todos plans overlap a.md b.md"],
        commands: [overlap],
      }),
      brief,
    ],
  });
  const spec = usageSpec(documented);
  const lines = spec.split("\n");

  it("writes a group's long help as a property and its examples first in its block", () => {
    const header = lines.findIndex((each) => each.startsWith("cmd plans "));
    expect(lines[header]).toBe(
      'cmd plans help="Work with plans" long_help="Plans are read from the repository.\\nNothing is written." subcommand_required=#true {',
    );
    expect(lines[header + 1]).toBe('    example "todos plans overlap a.md b.md"');
    expect(lines[header + 2]).toMatch(/^ {4}cmd overlap /);
  });

  it("writes a required rest as <plan>... and a rest alone as [path]...", () => {
    expect(spec).toContain('arg "<plan>..." help="A plan to compare"');
    expect(spec).toContain('arg "[path]..." help="A file to read"');
  });

  it("hands every operand to the tuple, and refuses a required rest given none", async () => {
    const many = await call(documented, { argv: ["plans", "overlap", "a.md", "b.md", "c.md"] });
    expect(many.code).toBe(0);
    expect(JSON.parse(many.out.join(""))).toEqual(["a.md", "b.md", "c.md"]);
    const none = await call(documented, { argv: ["brief"] });
    expect(none.code).toBe(0);
    expect(JSON.parse(none.out.join(""))).toEqual([]);
    const missing = await call(documented, { argv: ["plans", "overlap"] });
    expect(missing.code).toBe(2);
    expect(missing.err.join("")).toContain("plan");
  });

  it("shows the variadic argument in help as Commander writes one", async () => {
    const help = await call(documented, { argv: ["plans", "overlap", "--help"] });
    expect(help.out.join("")).toContain("<plan...>");
    const other = await call(documented, { argv: ["brief", "--help"] });
    expect(other.out.join("")).toContain("[path...]");
  });

  it("is read by the usage CLI, the group's long help and examples, and both rests", () => {
    const parsed = parsedByUsage(spec);
    const plans = parsed.cmd.subcommands["plans"];
    expect(plans?.help_long).toBe("Plans are read from the repository.\nNothing is written.");
    expect(plans?.examples.map((each) => each.code)).toEqual(["todos plans overlap a.md b.md"]);
    expect(plans?.subcommands["overlap"]?.args.map((each) => [each.name, each.required])).toEqual([
      ["plan", true],
    ]);
    expect(parsed.cmd.subcommands["brief"]?.args.map((each) => [each.name, each.required])).toEqual(
      [["path", false]],
    );
  });
});
