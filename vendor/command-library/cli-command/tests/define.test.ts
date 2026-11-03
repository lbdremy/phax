import * as Schema from "effect/Schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineCommand, defineProgram, reject, strip } from "../src/index.ts";

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
