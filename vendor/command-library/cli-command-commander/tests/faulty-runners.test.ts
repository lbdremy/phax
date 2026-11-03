import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { reject } from "@steme-lab/cli-command";
import type {
  Command,
  ExitCode,
  Inputs,
  Io,
  Program,
  Runner,
} from "@steme-lab/cli-command";
import { conformance } from "@steme-lab/cli-command/conformance";
import { runner as commander } from "../src/index.ts";

const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const named = <R>(program: Program<R>, io: Io): Command<R> | undefined =>
  program.commands.find((command) => command.name === io.argv[0]);

/** (1) A `strip` on the flags is applied as a `reject`. */
function stripAsReject<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const commands = program.commands.map((command): Command<R> => {
    const inputs: Inputs = command.input;
    return inputs.flags?.undeclared === "strip"
      ? {
          ...command,
          input: { ...inputs, flags: reject(inputs.flags.contract) },
        }
      : command;
  });
  return commander.run({ ...program, commands }, io);
}

/** (2) The word after an undeclared option is taken as its value, and goes with it. */
function wordAfterIsTheValue<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const inputs: Inputs = named(program, io)?.input ?? {};
  if (inputs.flags?.undeclared !== "strip") return commander.run(program, io);
  const declared = Object.keys(inputs.flags.contract.fields).map(
    (field) => `--${kebab(field)}`,
  );
  const [name = "", ...rest] = io.argv;
  const kept: string[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    const next = rest[at + 1];
    const takesNext = next !== undefined && !next.startsWith("-");
    if (!word.startsWith("--") || word === "--help") {
      kept.push(word);
    } else if (word.includes("=")) {
      if (declared.includes(word.slice(0, word.indexOf("=")))) kept.push(word);
    } else if (declared.includes(word)) {
      kept.push(word);
      if (takesNext) {
        kept.push(next);
        at += 1;
      }
    } else if (takesNext) {
      at += 1;
    }
  }
  return commander.run(program, { ...io, argv: [name, ...kept] });
}

/** (3) The environment handed to the runner is narrowed to the declared variables. */
function narrowedEnvironment<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const inputs: Inputs = named(program, io)?.input ?? {};
  if (inputs.env === undefined) return commander.run(program, io);
  const declared = Object.keys(inputs.env.contract.fields);
  const env = Object.fromEntries(
    Object.entries(io.env).filter(([key]) => declared.includes(key)),
  );
  return commander.run(program, { ...io, env });
}

/** (4) A call that `env: reject` refuses, for a variable its contract does not name, still runs
 *  the command it named, with an empty input, before the runner refuses it. Every refusal case
 *  of the suite proves that no run is called; this runner errs on one source only, so that one
 *  case alone catches it. */
function runOnRefusedCall<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const command = named(program, io);
  const inputs: Inputs = command?.input ?? {};
  if (command === undefined || inputs.env?.undeclared !== "reject") {
    return commander.run(program, io);
  }
  const declared = Object.keys(inputs.env.contract.fields);
  const refused = Object.keys(io.env).some((key) => !declared.includes(key));
  return refused
    ? Effect.exit(command.run({ input: {} })).pipe(
        Effect.flatMap(() => commander.run(program, io)),
      )
    : commander.run(program, io);
}

/** (5) Answers 1 wherever the runner answers the program's defect code. */
function oneForDefect<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  return commander
    .run(program, io)
    .pipe(Effect.map((code) => (code === program.exits.defect ? 1 : code)));
}

/** (6) Ignores `--`: drops it from the call, so the words after it are read as if it were not
 *  there, a dash-word as an option. */
function ignoresDoubleDash<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const [name = "", ...rest] = io.argv;
  const argv = [name, ...rest.filter((word) => word !== "--")];
  return commander.run(program, { ...io, argv });
}

/** (7) Detaches an option's `=value` when the value starts with `-`: `--to=-5` is read as
 *  `--to -5`, so such a value is never taken. */
function detachesValue<R>(
  program: Program<R>,
  io: Io,
): Effect.Effect<ExitCode, never, R> {
  const argv = io.argv.flatMap((word) => {
    const equals = word.indexOf("=");
    return word.startsWith("--") && equals !== -1 && word[equals + 1] === "-"
      ? [word.slice(0, equals), word.slice(equals + 1)]
      : [word];
  });
  return commander.run(program, { ...io, argv });
}

const faulty: ReadonlyArray<readonly [string, Runner, string]> = [
  [
    "strip as reject",
    { run: stripAsReject },
    "flags.strip.undeclared-dropped-alone",
  ],
  [
    "the word after is the option's value",
    { run: wordAfterIsTheValue },
    "flags.strip.word-after-is-its-own",
  ],
  [
    "a narrowed environment",
    { run: narrowedEnvironment },
    "env.reject.whole-environment",
  ],
  [
    "run on a refused call",
    { run: runOnRefusedCall },
    "env.reject.whole-environment",
  ],
  ["1 for a defect", { run: oneForDefect }, "defect.code"],
  ["-- ignored", { run: ignoresDoubleDash }, "args.after-double-dash"],
  [
    "an attached value detached",
    { run: detachesValue },
    "flags.attached-dash-value",
  ],
];

describe("the suite catches a runner that does not apply the definition", () => {
  for (const [fault, runner, id] of faulty) {
    it(`${fault}: fails ${id} alone`, async () => {
      const report = await Effect.runPromise(conformance(runner));
      const failed = report.cases.filter((entry) => !entry.held);
      expect(failed.map((entry) => entry.id)).toEqual([id]);
      expect(failed[0]?.why?.length).toBeGreaterThan(0);
      expect(report.failed).toBe(1);
      expect(report.held).toBe(report.cases.length - 1);
    });
  }
});
