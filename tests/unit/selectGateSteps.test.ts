import { describe, expect, it } from "vitest";
import { selectGateSteps } from "../../src/domain/gate/selectSteps.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";

function step(command: string, firing: GateStep["firing"]): GateStep {
  return { command, surface: "local", firing };
}

describe("selectGateSteps", () => {
  it("returns only every-phase steps when not terminal", () => {
    const steps = [
      step("pnpm format", "every-phase"),
      step("pnpm build", "terminal"),
      step("pnpm test", "every-phase"),
    ];

    expect(selectGateSteps(steps, false)).toEqual([
      step("pnpm format", "every-phase"),
      step("pnpm test", "every-phase"),
    ]);
  });

  it("returns every-phase and terminal steps when terminal, preserving order", () => {
    const steps = [
      step("pnpm format", "every-phase"),
      step("pnpm build", "terminal"),
      step("pnpm test", "every-phase"),
    ];

    expect(selectGateSteps(steps, true)).toEqual(steps);
  });

  it("returns all steps when every step is every-phase", () => {
    const steps = [step("pnpm format", "every-phase"), step("pnpm test", "every-phase")];

    expect(selectGateSteps(steps, false)).toEqual(steps);
    expect(selectGateSteps(steps, true)).toEqual(steps);
  });

  it("returns no steps when not terminal and every step is terminal", () => {
    const steps = [step("pnpm build", "terminal"), step("pnpm deno:smoke", "terminal")];

    expect(selectGateSteps(steps, false)).toEqual([]);
    expect(selectGateSteps(steps, true)).toEqual(steps);
  });
});
