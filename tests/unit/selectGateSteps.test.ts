import { describe, expect, it } from "vitest";
import { selectGateSteps } from "../../src/domain/gate/selectSteps.js";
import type { GateStep } from "../../src/schemas/phaxConfig.js";

const everyPhase = (command: string): GateStep => ({
  command,
  surface: "local",
  firing: "every-phase",
});

const terminal = (command: string): GateStep => ({
  command,
  surface: "product",
  firing: "terminal",
});

describe("selectGateSteps", () => {
  it("returns only every-phase steps when not terminal", () => {
    const steps = [everyPhase("pnpm test"), terminal("pnpm build"), everyPhase("pnpm lint")];
    const result = selectGateSteps(steps, false);
    expect(result).toEqual([everyPhase("pnpm test"), everyPhase("pnpm lint")]);
  });

  it("returns all steps when terminal", () => {
    const steps = [everyPhase("pnpm test"), terminal("pnpm build"), everyPhase("pnpm lint")];
    const result = selectGateSteps(steps, true);
    expect(result).toEqual(steps);
  });

  it("preserves input order", () => {
    const steps = [terminal("pnpm build"), everyPhase("pnpm test"), terminal("pnpm deno:smoke")];
    const result = selectGateSteps(steps, true);
    expect(result.map((s) => s.command)).toEqual(["pnpm build", "pnpm test", "pnpm deno:smoke"]);
  });

  it("returns all steps when all are every-phase and not terminal", () => {
    const steps = [everyPhase("pnpm test"), everyPhase("pnpm lint")];
    expect(selectGateSteps(steps, false)).toEqual(steps);
  });

  it("returns all steps when all are every-phase and terminal", () => {
    const steps = [everyPhase("pnpm test"), everyPhase("pnpm lint")];
    expect(selectGateSteps(steps, true)).toEqual(steps);
  });

  it("returns empty array when all steps are terminal and not terminal phase", () => {
    const steps = [terminal("pnpm build"), terminal("pnpm deno:smoke")];
    expect(selectGateSteps(steps, false)).toEqual([]);
  });

  it("returns all terminal steps when terminal phase and all are terminal", () => {
    const steps = [terminal("pnpm build"), terminal("pnpm deno:smoke")];
    expect(selectGateSteps(steps, true)).toEqual(steps);
  });

  it("returns empty array for empty input", () => {
    expect(selectGateSteps([], false)).toEqual([]);
    expect(selectGateSteps([], true)).toEqual([]);
  });
});
