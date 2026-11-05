import { describe, expect, it } from "vitest";
import { generateUsageSpec } from "../../scripts/generate-usage-spec.js";
import { fullName } from "../../src/cli/commandLibrary/contract/index.js";
import { phaxProgram } from "../../src/cli/definitions/program.js";

// Commands that must have both long_help and every example in the spec: each runner command
// whose definition declares a long help and examples (cliDocs held them before the commands
// moved onto the runner). This gate prevents a regression where the generator fails to emit the
// metadata a definition declares.
const DOCUMENTED_COMMANDS = phaxProgram.commands.filter(
  (command) => command.help !== undefined && (command.examples?.length ?? 0) > 0,
);

describe("usageSpec examples gate", () => {
  const spec = generateUsageSpec();

  it("covers the commands cliDocs documented before they moved", () => {
    const names = DOCUMENTED_COMMANDS.map((command) => fullName(command).join(" "));
    for (const name of ["run", "resume", "reset-phase", "enter-phase", "artifact decide"]) {
      expect(names).toContain(name);
    }
  });

  for (const command of DOCUMENTED_COMMANDS) {
    const cmdName = fullName(command).join(" ");
    it(`cmd "${cmdName}" has its long_help in the generated spec`, () => {
      expect(spec, `cmd "${cmdName}" is missing its long_help`).toContain(
        `long_help=${JSON.stringify(command.help)}`,
      );
    });

    it(`cmd "${cmdName}" has its example nodes in the generated spec`, () => {
      for (const example of command.examples ?? []) {
        expect(spec, `cmd "${cmdName}" is missing an example node`).toContain(
          `example ${JSON.stringify(example)}`,
        );
      }
    });
  }
});
