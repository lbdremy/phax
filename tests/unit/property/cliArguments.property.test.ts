// The command library's refusal contract, over any argument vector (§5.16, ac-cli-argv): a call
// runs a command and exits with a code the program declares, or is refused with the program's
// refused code, nothing on stdout and a message on stderr. It never ends with the defect code.
// Every code is read from the program's `exits`.
import { Effect, Exit } from "effect";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runner } from "../../../src/cli/commandLibrary/commander/run.js";
import { memoryIo } from "../../../src/cli/commandLibrary/contract/conformance/memoryIo.js";
import { anyArgv, knownArgv, type ArgvCase } from "../../helpers/property/argvInputs.js";
import { argvProgram, declaredExitCodes } from "../../helpers/property/argvProgram.js";
import { checkProperty, propertyTimeout } from "../../helpers/property/harness.js";

const program = argvProgram();
const declared = declaredExitCodes(program);
const inputs = fc.oneof(anyArgv(), knownArgv(program));
// The key the program's env source reads; its value is not what is under test.
const ENV = { PROP_PROFILE: "default" };

const runCase = (input: ArgvCase) => {
  const io = memoryIo({
    argv: input.argv,
    stdin: input.stdin,
    env: ENV,
    stdinIsTerminal: false,
  });
  return { io, exit: Effect.runSyncExit(runner.run(program, io.io)) };
};

const runsOrRefuses = (input: ArgvCase): boolean => {
  const { io, exit } = runCase(input);
  if (!Exit.isSuccess(exit) || typeof exit.value !== "number") return false;
  const code: number = exit.value;
  if (code === program.exits.defect) return false;
  if (code === program.exits.refused) return io.out() === "" && io.err() !== "";
  return declared.has(code);
};

describe("cli arguments", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit was called");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "any argv is run or refused through the contract",
    () => {
      checkProperty(inputs, runsOrRefuses);
    },
    propertyTimeout(),
  );

  it(
    "no argv reaches the process",
    () => {
      checkProperty(inputs, (input) => {
        runCase(input);
        return exitSpy.mock.calls.length === 0;
      });
      expect(exitSpy).not.toHaveBeenCalled();
    },
    propertyTimeout(),
  );
});
