import { Effect } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { conformance, type ConformanceReport } from "../src/conformance.ts";
import type { Runner } from "../src/index.ts";

const dying: Runner = {
  run: () => Effect.die(new Error("the runner is broken")),
};

// The suite is asynchronous since `written.record` hashes with WebCrypto.
const dyingReport = await Effect.runPromise(conformance(dying));

describe("conformance against a runner that dies", () => {
  const report = dyingReport;

  it("succeeds, with every case not held and a reason for each", () => {
    expect(report.cases.length).toBeGreaterThan(0);
    for (const entry of report.cases) {
      expect(entry.held, entry.id).toBe(false);
      expect(entry.why, entry.id).toEqual(expect.any(String));
      expect(entry.why?.length, entry.id).toBeGreaterThan(0);
    }
    expect(report.failed).toBe(report.cases.length);
    expect(report.held).toBe(0);
  });

  it("has unique ids of dotted lower-case words", () => {
    const ids = report.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(\.[a-z-]+)*$/);
  });

  it("is an Effect that fails with nothing and needs no service", () => {
    expectTypeOf(conformance(dying)).toEqualTypeOf<
      Effect.Effect<ConformanceReport, never, never>
    >();
  });
});

/** Runs the command a call names, or the program's first, and only then refuses: a refused call
 *  that calls a `run`, which §5.24 forbids. */
const runsThenRefuses: Runner = {
  run: (program, io) =>
    Effect.gen(function* () {
      const command =
        program.commands.find((candidate) => candidate.name === io.argv[0]) ??
        program.commands[0];
      if (command !== undefined) yield* Effect.exit(command.run({ input: {} }));
      yield* io.err("error: refused\n");
      return program.exits.refused;
    }),
};

/** Every case that expects a refusal. */
const refusalCases = [
  "args.reject.surplus",
  "args.missing",
  "args.reject.surplus-after-double-dash",
  "args.undeclared",
  "flags.reject.undeclared",
  "flags.missing",
  "flags.undeclared",
  "flags.strip.word-after-is-its-own",
  "source.strings",
  "stdin.reject.undeclared-key",
  "stdin.not-json",
  "env.reject.whole-environment",
  "call.unknown-command",
  "call.no-command",
  "refused.runs-nothing",
];

const refusingReport = await Effect.runPromise(conformance(runsThenRefuses));

describe("conformance against a runner that runs before it refuses", () => {
  const report = refusingReport;
  const entry = (id: string) => report.cases.find((found) => found.id === id);

  for (const id of refusalCases) {
    it(`fails ${id}, saying a run was called`, () => {
      expect(entry(id)?.held, id).toBe(false);
      expect(entry(id)?.why).toContain("no run should be called");
    });
  }

  it("fails the word after a bare undeclared option unless err names it", () => {
    expect(entry("flags.strip.word-after-is-its-own")?.why).toContain(
      "err should name yes",
    );
  });
});
