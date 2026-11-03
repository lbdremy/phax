// phax's runner program (src/cli/definitions/program.ts) passes the runner's misdeclared-program
// check, and a variant declaring an option the runner reserves does not (ac-misdeclared).
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
} from "../../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../../src/cli/definitions/program.js";
import { PHAX_RELEASE } from "../../../src/schemas/release.js";
import { call } from "../commandLibrary/commander/support/memoryIo.js";

describe("phaxProgram", () => {
  it("declares phax's name, release, exits, usage flag and program options", () => {
    expect(phaxProgram.name).toBe("phax");
    expect(phaxProgram.version).toBe(PHAX_RELEASE);
    expect(phaxProgram.exits).toEqual({ refused: 64, defect: 70 });
    expect(phaxProgram.usage).toEqual({
      flag: "usage",
      format: "usage-format",
      jsonSchema: "program",
    });
    expect(Object.keys(phaxProgram.options?.contract.fields ?? {})).toEqual(["verbose", "trace"]);
  });

  it("passes the runner's misdeclared-program check: --json-schema answers its catalogue", async () => {
    const result = await call(phaxProgram, { argv: ["--json-schema"] });
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(JSON.parse(result.out.join(""))).toMatchObject({
      program: "phax",
      version: PHAX_RELEASE,
      exits: { refused: 64, defect: 70 },
    });
  });

  it("a variant whose program declares an option json is refused as a defect", async () => {
    const variant = defineProgram({
      name: phaxProgram.name,
      version: phaxProgram.version,
      exits: phaxProgram.exits,
      commands: [],
      options: reject(
        Schema.Struct({ json: Schema.optionalWith(Schema.Boolean, { exact: true }) }),
      ),
    });
    const result = await call(variant, { argv: ["--json-schema"] });
    expect(result.code).toBe(70);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("--json, which the runner reserves");
  });

  it("a variant with a command declaring an option json is refused, naming the command", async () => {
    const lint = defineCommand({
      name: "lint",
      summary: "Lint a plan",
      input: {
        flags: reject(
          Schema.Struct({ json: Schema.optionalWith(Schema.Boolean, { exact: true }) }),
        ),
      },
      output: strip(Schema.String),
      exits: {},
      run: () => Effect.succeed("ok"),
    });
    const variant = defineProgram({
      name: phaxProgram.name,
      version: phaxProgram.version,
      exits: phaxProgram.exits,
      ...(phaxProgram.usage === undefined ? {} : { usage: phaxProgram.usage }),
      ...(phaxProgram.options === undefined ? {} : { options: phaxProgram.options }),
      commands: [defineGroup({ name: "plans", summary: "Plans", commands: [lint] })],
    });
    const result = await call(variant, { argv: ["plans", "lint"] });
    expect(result.code).toBe(70);
    expect(result.err.join("")).toContain("plans lint declares --json, which the runner reserves");
  });
});
