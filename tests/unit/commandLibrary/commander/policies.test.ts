import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";
import { programOf } from "./support/todos.js";

const spy = () => vi.fn((_input: unknown) => Effect.succeed("done"));

describe("an undeclared option under strip is dropped alone", () => {
  const run = spy();
  const tagTodo = defineCommand({
    name: "tag-todo",
    summary: "tag a todo",
    input: {
      args: reject(Schema.Tuple(Schema.String)),
      flags: strip(Schema.Struct({ to: Schema.String })),
    },
    exits: {},
    run: ({ input }) => run(input),
    output: strip(Schema.String),
    render: (text) => text,
  });
  const program = programOf([tagTodo]);

  const reaching: ReadonlyArray<ReadonlyArray<string>> = [
    ["tag-todo", "t1", "--to", "one", "--force"],
    ["tag-todo", "t1", "--force=yes", "--to", "one"],
    ["tag-todo", "--force", "t1", "--to", "one"],
  ];

  for (const argv of reaching) {
    it(`hands run the declared options only for \`${argv.join(" ")}\``, async () => {
      run.mockClear();
      const result = await call(program, { argv });
      expect(result.code).toBe(0);
      expect(run).toHaveBeenCalledWith({
        args: ["t1"],
        flags: { to: "one" },
      });
    });
  }

  it("reads the word after a bare undeclared option as a surplus argument", async () => {
    run.mockClear();
    const result = await call(program, {
      argv: ["tag-todo", "t1", "--force", "yes", "--to", "one"],
    });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("yes");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("env decodes the whole environment", () => {
  const TodosDb = Schema.Struct({ TODOS_DB: Schema.String });
  const makeEnvCommand = (policy: typeof reject | typeof strip) => {
    const run = spy();
    const command = defineCommand({
      name: "env-todo",
      summary: "read the environment",
      input: { env: policy(TodosDb) },
      exits: {},
      run: ({ input }) => run(input),
      output: strip(Schema.String),
      render: (text) => text,
    });
    return { run, program: programOf([command]) };
  };
  const full = { TODOS_DB: "db", PATH: "/bin" };

  it("refuses under reject a variable the contract does not name", async () => {
    const { run, program } = makeEnvCommand(reject);
    const result = await call(program, { argv: ["env-todo"], env: full });
    expect(result.code).toBe(2);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("PATH");
    expect(run).not.toHaveBeenCalled();
  });

  it("hands run the variable it names, under strip", async () => {
    const { run, program } = makeEnvCommand(strip);
    const result = await call(program, { argv: ["env-todo"], env: full });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ env: { TODOS_DB: "db" } });
  });

  it("runs under reject when the environment is only what the contract names", async () => {
    const { run, program } = makeEnvCommand(reject);
    const result = await call(program, {
      argv: ["env-todo"],
      env: { TODOS_DB: "db" },
    });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ env: { TODOS_DB: "db" } });
  });

  it("does not count a variable whose value is undefined", async () => {
    const { run, program } = makeEnvCommand(reject);
    const result = await call(program, {
      argv: ["env-todo"],
      env: { TODOS_DB: "db", PATH: undefined },
    });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ env: { TODOS_DB: "db" } });
  });
});

describe("the other policies, as declared", () => {
  const Body = Schema.Struct({ name: Schema.String });
  const runs = { args: spy(), reject: spy(), strip: spy(), none: spy() };
  const program = programOf([
    defineCommand({
      name: "args-strip",
      summary: "strip the surplus arguments",
      input: { args: strip(Schema.Tuple(Schema.String)) },
      exits: {},
      run: ({ input }) => runs.args(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "stdin-reject",
      summary: "reject an undeclared key",
      input: { stdin: reject(Body) },
      exits: {},
      run: ({ input }) => runs.reject(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "stdin-strip",
      summary: "drop an undeclared key",
      input: { stdin: strip(Body) },
      exits: {},
      run: ({ input }) => runs.strip(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "no-stdin",
      summary: "read no stdin",
      input: {},
      exits: {},
      run: () => runs.none(undefined),
      output: strip(Schema.String),
      render: (text) => text,
    }),
  ]);
  const extra = JSON.stringify({ name: "n", extra: 1 });

  it("drops a surplus argument under args strip", async () => {
    const result = await call(program, { argv: ["args-strip", "t1", "t2"] });
    expect(result.code).toBe(0);
    expect(runs.args).toHaveBeenCalledWith({ args: ["t1"] });
    expect(result.stdinReads()).toBe(0);
  });

  it("refuses under stdin reject an undeclared key, then text that is not JSON", async () => {
    const withKey = await call(program, {
      argv: ["stdin-reject"],
      stdin: extra,
    });
    expect(withKey.code).toBe(2);
    expect(withKey.out).toEqual([]);
    expect(withKey.err.join("")).toContain("extra");
    expect(withKey.stdinReads()).toBe(1);

    const notJson = await call(program, {
      argv: ["stdin-reject"],
      stdin: "not json",
    });
    expect(notJson.code).toBe(2);
    expect(notJson.out).toEqual([]);
    expect(notJson.err.join("")).toContain("stdin is not JSON");
    expect(notJson.stdinReads()).toBe(1);
    expect(runs.reject).not.toHaveBeenCalled();
  });

  it("hands run the JSON without the undeclared key under stdin strip", async () => {
    const result = await call(program, {
      argv: ["stdin-strip"],
      stdin: extra,
    });
    expect(result.code).toBe(0);
    expect(runs.strip).toHaveBeenCalledWith({ stdin: { name: "n" } });
    expect(result.stdinReads()).toBe(1);
  });

  it("does not evaluate stdin for a command that declares none", async () => {
    const result = await call(program, { argv: ["no-stdin"], stdin: extra });
    expect(result.code).toBe(0);
    expect(result.stdinReads()).toBe(0);
    expect(runs.none).toHaveBeenCalledTimes(1);
  });

  it("does not evaluate stdin for a refused call", async () => {
    const result = await call(program, {
      argv: ["stdin-strip", "surplus"],
      stdin: extra,
    });
    expect(result.code).toBe(2);
    expect(result.stdinReads()).toBe(0);
  });
});

describe("a word that starts with - is an option, under every policy", () => {
  const runs = { num: spy(), tag: spy(), opts: spy() };
  const program = programOf([
    defineCommand({
      name: "num",
      summary: "take one argument, no options",
      input: { args: reject(Schema.Tuple(Schema.String)) },
      exits: {},
      run: ({ input }) => runs.num(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "opts",
      summary: "reject an undeclared option",
      input: {
        args: reject(Schema.Tuple(Schema.String)),
        flags: reject(Schema.Struct({ to: Schema.String })),
      },
      exits: {},
      run: ({ input }) => runs.opts(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "tag",
      summary: "drop an undeclared option",
      input: {
        args: reject(Schema.Tuple(Schema.String)),
        flags: strip(Schema.Struct({ to: Schema.String })),
      },
      exits: {},
      run: ({ input }) => runs.tag(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
  ]);
  const clear = () => {
    for (const run of Object.values(runs)) run.mockClear();
  };

  const refused: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
    [["num", "-5"], "-5"],
    [["num", "t1", "-5"], "-5"],
    [["num", "-"], "-"],
    [["num", "t1", "-x"], "-x"],
    [["opts", "-5", "--to", "one"], "-5"],
    [["opts", "t1", "--to", "one", "-5"], "-5"],
    [["opts", "t1", "--to", "-5"], "--to"],
    [["tag", "t1", "--to", "-5"], "--to"],
    [["tag", "-5", "--to", "one"], "missing"],
  ];
  for (const [argv, named] of refused) {
    it(`refuses \`${argv.join(" ")}\`, naming ${named}`, async () => {
      clear();
      const result = await call(program, { argv });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.join("")).toContain(named);
      expect(runs.num).not.toHaveBeenCalled();
      expect(runs.opts).not.toHaveBeenCalled();
      expect(runs.tag).not.toHaveBeenCalled();
    });
  }

  const stripped: ReadonlyArray<ReadonlyArray<string>> = [
    ["tag", "-5", "t1", "--to", "one"],
    ["tag", "t1", "-5", "--to", "one"],
    ["tag", "t1", "--to", "one", "-5"],
    ["tag", "t1", "-", "--to", "one"],
  ];
  for (const argv of stripped) {
    it(`drops each option alone under strip for \`${argv.join(" ")}\``, async () => {
      clear();
      const result = await call(program, { argv });
      expect(result.code).toBe(0);
      expect(runs.tag).toHaveBeenCalledWith({
        args: ["t1"],
        flags: { to: "one" },
      });
    });
  }

  it("names both the undeclared option and the surplus word under reject", async () => {
    clear();
    const result = await call(program, {
      argv: ["opts", "t1", "--force", "yes", "--to", "one"],
    });
    expect(result.code).toBe(2);
    const err = result.err.join("");
    expect(err).toContain("--force");
    expect(err).toContain("yes");
    expect(runs.opts).not.toHaveBeenCalled();
  });
});

describe("-- ends the options, and an attached value may start with -", () => {
  const runs = { num: spy(), loose: spy(), opts: spy() };
  const program = programOf([
    defineCommand({
      name: "num",
      summary: "take one argument, no options",
      input: { args: reject(Schema.Tuple(Schema.String)) },
      exits: {},
      run: ({ input }) => runs.num(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "loose",
      summary: "drop a surplus argument",
      input: { args: strip(Schema.Tuple(Schema.String)) },
      exits: {},
      run: ({ input }) => runs.loose(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
    defineCommand({
      name: "opts",
      summary: "one argument, one valued option",
      input: {
        args: reject(Schema.Tuple(Schema.String)),
        flags: reject(Schema.Struct({ to: Schema.String })),
      },
      exits: {},
      run: ({ input }) => runs.opts(input),
      output: strip(Schema.String),
      render: (text) => text,
    }),
  ]);
  const clear = () => {
    for (const run of Object.values(runs)) run.mockClear();
  };

  const reaching: ReadonlyArray<readonly [ReadonlyArray<string>, keyof typeof runs, unknown]> = [
    [["num", "--", "-x"], "num", { args: ["-x"] }],
    [["num", "t1", "--"], "num", { args: ["t1"] }],
    [["num", "--", "--"], "num", { args: ["--"] }],
    [["num", "--", "-h"], "num", { args: ["-h"] }],
    [["loose", "--", "t1", "-x"], "loose", { args: ["t1"] }],
    [["opts", "--to", "one", "--", "-x"], "opts", { args: ["-x"], flags: { to: "one" } }],
    [["opts", "--to=-5", "t1"], "opts", { args: ["t1"], flags: { to: "-5" } }],
  ];
  for (const [argv, name, input] of reaching) {
    it(`hands run what \`${argv.join(" ")}\` gives`, async () => {
      clear();
      const result = await call(program, { argv });
      expect(result.code).toBe(0);
      expect(runs[name]).toHaveBeenCalledWith(input);
    });
  }

  const refused: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
    [["num", "--", "t1", "-x"], "too many arguments: -x"],
    [["num", "--", "t1", "--"], "too many arguments: --"],
    [["opts", "t1", "--to", "one", "--", "x"], "too many arguments: x"],
    [["opts", "--", "t1", "--to", "one"], "too many arguments: --to one"],
    [["opts", "t1", "--to", "-5"], "'--to' argument missing"],
  ];
  for (const [argv, named] of refused) {
    it(`refuses \`${argv.join(" ")}\`, saying ${named}`, async () => {
      clear();
      const result = await call(program, { argv });
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.join("")).toContain(named);
      for (const run of Object.values(runs)) expect(run).not.toHaveBeenCalled();
    });
  }
});

// Gain carried for upstream (options for every command): read wherever they stand.
function traced() {
  const seen: unknown[] = [];
  const show = defineCommand({
    name: "show",
    summary: "show",
    input: { args: reject(Schema.Tuple(Schema.String)) },
    output: strip(Schema.String),
    exits: {},
    run: (context) =>
      Effect.sync(() => {
        seen.push({ input: context.input, program: context.program });
        return "shown";
      }),
  });
  const program = defineProgram({
    name: "todos",
    version: "1.0.0",
    exits: { refused: 2, defect: 70 },
    options: reject(
      Schema.Struct({
        verbose: Schema.optionalWith(Schema.Boolean, { exact: true }),
        trace: Schema.optionalWith(Schema.Literal("off", "on"), { default: () => "off" }),
      }),
    ),
    commands: [defineGroup({ name: "runs", summary: "Runs", commands: [show] })],
  });
  return { program, seen };
}

describe("the program's options", () => {
  it("hands run a valued option, spaced or attached, and its default", async () => {
    for (const [argv, options] of [
      [["--trace", "on", "runs", "show", "a"], { trace: "on" }],
      [["runs", "--trace=on", "show", "a", "--verbose"], { verbose: true, trace: "on" }],
      [["runs", "show", "a"], { trace: "off" }],
    ] as const) {
      const { program, seen } = traced();
      const result = await call(program, { argv: [...argv] });
      expect(result.code, argv.join(" ")).toBe(0);
      expect(seen, argv.join(" ")).toEqual([{ input: { args: ["a"] }, program: options }]);
    }
  });

  it("leaves a word after -- to the command", async () => {
    const { program, seen } = traced();
    const result = await call(program, { argv: ["runs", "show", "--", "--verbose"] });
    expect(result.code).toBe(0);
    expect(seen).toEqual([{ input: { args: ["--verbose"] }, program: { trace: "off" } }]);
  });

  it("refuses a value that does not decode, and a valued option given none", async () => {
    for (const argv of [
      ["runs", "show", "a", "--trace", "loud"],
      ["runs", "show", "a", "--trace"],
    ]) {
      const { program, seen } = traced();
      const result = await call(program, { argv: [...argv, "--json"] });
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.out).toEqual([]);
      const [line] = result.err.join("").split("\n");
      expect(JSON.parse(line ?? ""), argv.join(" ")).toMatchObject({
        kind: "refused",
        source: "flags",
        path: ["--trace"],
      });
      expect(seen).toEqual([]);
    }
  });

  it("are listed in the program's help", async () => {
    const { program } = traced();
    const help = await call(program, { argv: ["--help"] });
    expect(help.code).toBe(0);
    expect(help.out.join("")).toContain("--verbose");
    expect(help.out.join("")).toContain("--trace <trace>");
  });
});

// Fix: a negated switch, `--no-probe`, which Commander keeps under its positive attribute.
describe("a negated switch", () => {
  const probing = () => {
    const run = spy();
    const command = defineCommand({
      name: "estimate",
      summary: "estimate",
      input: {
        flags: reject(
          Schema.Struct({
            noProbe: Schema.optionalWith(
              Schema.Boolean.annotations({ description: "Skip the probe" }),
              { exact: true },
            ),
            dryRun: Schema.optionalWith(Schema.Boolean, { exact: true }),
          }),
        ),
      },
      output: strip(Schema.String),
      exits: {},
      run: ({ input }) => run(input),
    });
    return { program: programOf([command]), run };
  };

  it("reaches run as true when given", async () => {
    const { program, run } = probing();
    const result = await call(program, { argv: ["estimate", "--no-probe"] });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ flags: { noProbe: true } });
  });

  it("stays absent when not given", async () => {
    const { program, run } = probing();
    const result = await call(program, { argv: ["estimate", "--dry-run"] });
    expect(result.code).toBe(0);
    expect(run).toHaveBeenCalledWith({ flags: { dryRun: true } });
  });

  it("is refused with a value, as any switch is", async () => {
    const { program, run } = probing();
    const result = await call(program, { argv: ["estimate", "--no-probe=yes"] });
    expect(result.code).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("shows as --no-probe in help, the catalogue and the usage spec", async () => {
    const { program } = probing();
    const help = await call(program, { argv: ["estimate", "--help"] });
    expect(help.out.join("")).toContain("--no-probe");
    expect(help.out.join("")).toContain("Skip the probe");
    const entry = await call(program, { argv: ["estimate", "--json-schema"] });
    const parsed = JSON.parse(entry.out.join("")) as {
      input: { properties: Record<string, unknown> };
    };
    expect(Object.keys(parsed.input.properties)).toContain("no-probe");
    const spec = await call(program, { argv: ["--usage-spec"] });
    expect(spec.out.join("")).toContain(`flag --no-probe help="Skip the probe"`);
  });
});
