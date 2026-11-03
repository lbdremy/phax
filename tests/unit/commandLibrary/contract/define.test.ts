import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  fullName,
  reject,
  strip,
} from "../../../../src/cli/commandLibrary/contract/index.js";

const Flags = Schema.Struct({ to: Schema.String });

const command = {
  name: "rename",
  summary: "Rename",
  input: {},
  exits: {},
  run: () => {
    throw new Error("never run by a definition");
  },
  render: () => "",
};

describe("definitions are the values they are given", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("defineCommand answers its argument", () => {
    // oxlint-disable-next-line typescript/no-explicit-any
    const d: any = command;
    expect(defineCommand(d)).toBe(d);
  });

  it("defineProgram answers its argument", () => {
    const p = {
      name: "tool",
      version: "1.0.0",
      exits: { refused: 64, defect: 99 },
      commands: [],
    };
    expect(defineProgram(p)).toBe(p);
  });

  it("reject and strip pair the contract with its policy", () => {
    const rejected = reject(Flags);
    expect(rejected).toEqual({ contract: Flags, undeclared: "reject" });
    expect(rejected.contract).toBe(Flags);
    const stripped = strip(Flags);
    expect(stripped).toEqual({ contract: Flags, undeclared: "strip" });
    expect(stripped.contract).toBe(Flags);
  });

  it("records no output and no timer, and throws nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(() => {
      // oxlint-disable-next-line typescript/no-explicit-any
      defineCommand(command as any);
      defineProgram({
        name: "tool",
        version: "1.0.0",
        exits: { refused: 64, defect: 99 },
        commands: [],
      });
      reject(Flags);
      strip(Flags);
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("the gains' declarations", () => {
  const leaf = defineCommand({
    name: "leaf",
    summary: "A leaf",
    input: {},
    exits: {},
    run: () => Effect.void,
  });
  const top = defineCommand({
    name: "top",
    summary: "A top command",
    input: {},
    exits: {},
    run: () => Effect.void,
  });

  it("a nested group's commands carry their chain of groups, outermost last", () => {
    const program = defineProgram({
      name: "tool",
      version: "1.0.0",
      exits: { refused: 64, defect: 70 },
      commands: [
        top,
        defineGroup({
          name: "outer",
          summary: "Outer",
          commands: [top, defineGroup({ name: "inner", summary: "Inner", commands: [leaf] })],
        }),
      ],
    });
    expect(program.commands.map(fullName)).toEqual([
      ["top"],
      ["outer", "top"],
      ["outer", "inner", "leaf"],
    ]);
    expect(program.commands[2]?.group).toEqual({
      name: "inner",
      summary: "Inner",
      parent: { name: "outer", summary: "Outer" },
    });
    expect(program.commands[0]?.group).toBeUndefined();
  });

  it("a stdin source keeps a text document and a required flag value only when declared", () => {
    const Doc = Schema.String;
    expect(reject(Doc, { text: true })).toEqual({
      contract: Doc,
      undeclared: "reject",
      text: true,
    });
    expect(reject(Doc, { flag: "verdicts", required: true, valueRequired: true })).toEqual({
      contract: Doc,
      undeclared: "reject",
      flag: "verdicts",
      required: true,
      valueRequired: true,
    });
    expect(strip(Doc, { flag: "brief" })).toEqual({
      contract: Doc,
      undeclared: "strip",
      flag: "brief",
      required: false,
    });
    // A value is required of a flag only: without a flag there is none to require it of.
    expect(reject(Doc, { valueRequired: true })).toEqual({ contract: Doc, undeclared: "reject" });
  });

  it("a program keeps its usage flag and its options as given", () => {
    const options = reject(
      Schema.Struct({ verbose: Schema.optionalWith(Schema.Boolean, { exact: true }) }),
    );
    const program = defineProgram({
      name: "tool",
      version: "1.0.0",
      exits: { refused: 64, defect: 70 },
      commands: [defineGroup({ name: "g", summary: "G", commands: [leaf] })],
      usage: { flag: "usage", format: "usage-format", jsonSchema: "program" },
      options,
    });
    expect(program.usage).toEqual({ flag: "usage", format: "usage-format", jsonSchema: "program" });
    expect(program.options).toBe(options);
  });
});
