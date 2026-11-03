import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { defineCommand, reject, strip } from "@steme-lab/cli-command";
import { call } from "./support/memory-io.ts";
import { programOf } from "./support/todos.ts";

const Request = Schema.Struct({ todos: Schema.Array(Schema.String) }).annotate({
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
      flags: reject(
        Schema.Struct({ format: Schema.optionalKey(Schema.String) }),
      ),
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
    expect(seen).toEqual([
      { flags: { format: "gate" }, stdin: { todos: ["a"] } },
    ]);
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
      [Schema.Struct({}).annotate({ title: "a ledger" }), "a ledger"],
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
    expect(result.err.join("")).toBe(
      "error: missing.json: no such file or directory\n",
    );
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
    expect(undeclared.err.join("")).toContain(
      "error: b.json does not decode: undeclared extra",
    );
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
    expect(undeclared.err.join("")).toContain(
      "error: stdin does not decode: undeclared extra",
    );
  });
});
