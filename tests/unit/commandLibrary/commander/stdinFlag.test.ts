import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { runner } from "../../../../src/cli/commandLibrary/commander/index.js";
import { defineCommand, reject, strip } from "../../../../src/cli/commandLibrary/contract/index.js";
import { call, memoryIo } from "./support/memoryIo.js";
import { programOf } from "./support/todos.js";

const Request = Schema.Struct({ todos: Schema.Array(Schema.String) }).annotations({
  identifier: "gate-request",
});
const document = JSON.stringify({ todos: ["a"] });

/** A command reading its stdin bound to `--request`; `seen` holds the input each run received. */
function make(binding: { readonly required?: boolean } = {}) {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "audit",
    summary: "audit",
    input: {
      flags: reject(Schema.Struct({ format: Schema.optionalWith(Schema.String, { exact: true }) })),
      stdin: reject(Request, { flag: "request", ...binding }),
    },
    output: strip(Schema.String),
    exits: {},
    run: ({ input }) =>
      Effect.sync(() => {
        seen.push(input);
        return "ran";
      }),
    render: (text) => text,
  });
  return { program: programOf([command]), seen };
}

describe("a stdin read bound to a flag", () => {
  it("reads stdin for the bare flag, for `-` and for `=-`", async () => {
    for (const argv of [
      ["audit", "--request"],
      ["audit", "--request", "-"],
      ["audit", "--request=-"],
    ]) {
      const { program, seen } = make();
      const result = await call(program, { argv, stdin: document });
      expect(result.code, argv.join(" ")).toBe(0);
      expect(seen).toEqual([{ flags: {}, stdin: { todos: ["a"] } }]);
      expect(result.stdinReads()).toBe(1);
    }
  });

  it("reads the attached path through Io and never opens stdin", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit", "--request=in.json"],
      stdin: "ignored",
      files: { "in.json": document },
    });
    expect(result.code).toBe(0);
    expect(seen).toEqual([{ flags: {}, stdin: { todos: ["a"] } }]);
    expect(result.stdinReads()).toBe(0);
    expect(result.fileReads()).toEqual(["in.json"]);
  });

  it("takes the flag among other options, wherever it is", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit", "--request=in.json", "--format", "gate"],
      files: { "in.json": document },
    });
    expect(result.code).toBe(0);
    expect(seen).toEqual([{ flags: { format: "gate" }, stdin: { todos: ["a"] } }]);
  });

  it("leaves a word after the bare flag, which is not `-`, as a stray word", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit", "--request", "in.json"],
      stdin: document,
      files: { "in.json": document },
    });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toContain("too many arguments: in.json");
    expect(seen).toEqual([]);
    expect(result.stdinReads()).toBe(0);
    expect(result.fileReads()).toEqual([]);
  });

  it("reads nothing after `--`", async () => {
    const { program } = make();
    const result = await call(program, {
      argv: ["audit", "--", "--request"],
      stdin: document,
    });
    expect(result.code).toBe(2);
    expect(result.stdinReads()).toBe(0);
  });

  it("hands run no document, and reads nothing, when the flag is absent", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit"],
      stdin: document,
    });
    expect(result.code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(Reflect.get(seen[0] as object, "stdin")).toBeUndefined();
    expect(result.stdinReads()).toBe(0);
  });

  it("shows the flag in the command's help", async () => {
    const { program } = make();
    const result = await call(program, { argv: ["audit", "--help"] });
    expect(result.code).toBe(0);
    expect(result.out.join("")).toContain("--request [path]");
    expect(result.stdinReads()).toBe(0);
  });
});

describe("the refusals of a stdin read", () => {
  it("names the format when stdin is a terminal and no flag is bound", async () => {
    const seen: unknown[] = [];
    const command = defineCommand({
      name: "rename-todos",
      summary: "rename",
      input: { stdin: reject(Request) },
      output: strip(Schema.String),
      exits: {},
      run: ({ input }) =>
        Effect.sync(() => {
          seen.push(input);
          return "ran";
        }),
    });
    const result = await call(programOf([command]), {
      argv: ["rename-todos"],
      stdinIsTerminal: true,
    });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toBe(
      "error: rename-todos reads a document of format gate-request on stdin, and stdin is a terminal: pipe it in\n",
    );
    expect(result.stdinReads()).toBe(0);
    expect(result.out).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("names the format and the flag when stdin is a terminal and the flag is bare", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit", "--request"],
      stdinIsTerminal: true,
    });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toBe(
      "error: audit --request reads a gate-request on stdin, and stdin is a terminal: pipe it in, or give --request=<path>\n",
    );
    expect(result.stdinReads()).toBe(0);
    expect(seen).toEqual([]);
  });

  it("reads a file even when stdin is a terminal", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit", "--request=in.json"],
      stdinIsTerminal: true,
      files: { "in.json": document },
    });
    expect(result.code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(result.stdinReads()).toBe(0);
  });

  it("names the title, then JSON, when the contract has no identifier", async () => {
    for (const [contract, name] of [
      [Schema.Struct({}).annotations({ title: "a ledger" }), "a ledger"],
      [Schema.Struct({}), "JSON"],
    ] as const) {
      const command = defineCommand({
        name: "read",
        summary: "read",
        input: { stdin: reject(contract, { flag: "doc" }) },
        output: strip(Schema.String),
        exits: {},
        run: () => Effect.succeed("ran"),
      });
      const result = await call(programOf([command]), {
        argv: ["read", "--doc"],
        stdinIsTerminal: true,
      });
      expect(result.err.join("")).toContain(`read --doc reads a ${name} on`);
    }
  });

  it("refuses a required document without its flag, naming the flag, before reading", async () => {
    const { program, seen } = make({ required: true });
    const result = await call(program, { argv: ["audit"], stdin: document });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toBe(
      "error: audit requires --request: pipe a gate-request in with --request, or give --request=<path>\n",
    );
    expect(result.stdinReads()).toBe(0);
    expect(seen).toEqual([]);
  });

  it("names a missing file by its path and why", async () => {
    const { program, seen } = make();
    const result = await call(program, {
      argv: ["audit", "--request=missing.json"],
    });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toBe("error: missing.json: no such file or directory\n");
    expect(seen).toEqual([]);
  });

  it("refuses a flag attached to nothing", async () => {
    const { program } = make();
    const result = await call(program, { argv: ["audit", "--request="] });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toContain("--request= is given no path");
  });

  it("names the path, not stdin, when a file is not JSON or does not decode", async () => {
    const { program, seen } = make();
    const notJson = await call(program, {
      argv: ["audit", "--request=a.json"],
      files: { "a.json": "not json" },
    });
    expect(notJson.err.join("")).toBe("error: a.json is not JSON\n");
    const undeclared = await call(program, {
      argv: ["audit", "--request=b.json"],
      files: { "b.json": JSON.stringify({ todos: [], extra: 1 }) },
    });
    expect(undeclared.err.join("")).toContain("error: b.json does not decode: undeclared extra");
    expect([notJson.code, undeclared.code]).toEqual([2, 2]);
    expect(seen).toEqual([]);
  });

  it("keeps today's texts for stdin", async () => {
    const { program } = make();
    const notJson = await call(program, {
      argv: ["audit", "--request"],
      stdin: "not json",
    });
    expect(notJson.err.join("")).toBe("error: stdin is not JSON\n");
    const undeclared = await call(program, {
      argv: ["audit", "--request"],
      stdin: JSON.stringify({ todos: [], extra: 1 }),
    });
    expect(undeclared.err.join("")).toContain("error: stdin does not decode: undeclared extra");
  });
});

// Gain carried for upstream (a required stdin-flag value): `--<flag> <file|->`, spaced or attached.
describe("a stdin flag whose value is required", () => {
  function valued() {
    const seen: unknown[] = [];
    const command = defineCommand({
      name: "decide",
      summary: "decide",
      input: {
        flags: reject(
          Schema.Struct({ dryRun: Schema.optionalWith(Schema.Boolean, { exact: true }) }),
        ),
        stdin: reject(Request, { flag: "verdicts", required: true, valueRequired: true }),
      },
      output: strip(Schema.String),
      exits: {},
      run: ({ input }) =>
        Effect.sync(() => {
          seen.push(input);
          return "ok";
        }),
    });
    return { program: programOf([command]), seen };
  }

  it("reads the file named after a space, and leaves the next words as they are", async () => {
    const { program, seen } = valued();
    const result = await call(program, {
      argv: ["decide", "--verdicts", "in.json", "--dry-run"],
      files: { "in.json": document },
    });
    expect(result.code).toBe(0);
    expect(result.stdinReads()).toBe(0);
    expect(seen).toEqual([{ flags: { dryRun: true }, stdin: { todos: ["a"] } }]);
  });

  it("refuses the flag followed by an option, naming it, and reads nothing", async () => {
    const { program, seen } = valued();
    const result = await call(program, {
      argv: ["decide", "--verdicts", "--dry-run", "--json"],
      stdin: document,
    });
    expect(result.code).toBe(2);
    expect(result.stdinReads()).toBe(0);
    expect(result.fileReads()).toEqual([]);
    const [line] = result.err.join("").split("\n");
    expect(JSON.parse(line ?? "")).toMatchObject({
      kind: "refused",
      source: "stdin",
      path: ["--verdicts"],
      text: "error: option '--verdicts <file|->' argument missing",
    });
    expect(seen).toEqual([]);
  });

  it("says the value it requires when the flag is absent", async () => {
    const { program } = valued();
    const result = await call(program, { argv: ["decide"], stdin: document });
    expect(result.code).toBe(2);
    expect(result.err.join("")).toContain("requires --verdicts <file|->");
    expect(result.stdinReads()).toBe(0);
  });

  it("shows the flag as --verdicts <file|-> in its help", async () => {
    const { program } = valued();
    const help = await call(program, { argv: ["decide", "--help"] });
    expect(help.code).toBe(0);
    expect(help.out.join("")).toContain("--verdicts <file|->");
  });
});

// Gain carried for upstream (a text stdin document): the text is handed to its contract as read.
function briefed() {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "new",
    summary: "new",
    input: { stdin: reject(Schema.String, { flag: "brief", text: true }) },
    output: strip(Schema.String),
    exits: {},
    run: ({ input }) =>
      Effect.sync(() => {
        seen.push(input);
        return "ok";
      }),
  });
  return { program: programOf([command]), seen };
}

describe("a text document on a stdin flag", () => {
  it("hands run the text as read, never parsed as JSON", async () => {
    const { program, seen } = briefed();
    const text = '{"not": "parsed"}\n';
    const result = await call(program, { argv: ["new", "--brief"], stdin: text });
    expect(result.code).toBe(0);
    expect(seen).toEqual([{ stdin: text }]);
  });

  it("calls a file that is no UTF-8 text by what it is", async () => {
    const { program, seen } = briefed();
    const memory = memoryIo({ argv: ["new", "--brief=brief.md"] });
    const io = { ...memory.io, readFile: () => Effect.succeed(new Uint8Array([0xff, 0xfe])) };
    const code = await Effect.runPromise(runner.run(program, io));
    expect(code).toBe(2);
    expect(memory.err.join("")).toBe("error: brief.md is not UTF-8 text\n");
    expect(seen).toEqual([]);
  });

  it("says text in its help, and calls the document text on a terminal", async () => {
    const { program } = briefed();
    const help = await call(program, { argv: ["new", "--help"] });
    expect(help.out.join("")).toContain("stdin: text");
    const terminal = await call(program, { argv: ["new", "--brief"], stdinIsTerminal: true });
    expect(terminal.code).toBe(2);
    expect(terminal.err.join("")).toContain("reads a text on stdin");
    expect(terminal.stdinReads()).toBe(0);
  });
});
