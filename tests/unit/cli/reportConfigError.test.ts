import { describe, it, expect } from "vitest";
import type { OutputPort } from "../../../src/ports/output.js";
import { reportConfigError } from "../../../src/cli/commands/reportConfigError.js";
import { ConfigValidationError } from "../../../src/domain/errors.js";

function makeFakeOut() {
  const errors: string[] = [];
  const out: OutputPort = {
    log: () => {},
    warn: () => {},
    error: (msg: string) => errors.push(msg),
  };
  return { out, errors };
}

describe("reportConfigError", () => {
  it("prints the error message", () => {
    const { out, errors } = makeFakeOut();
    const err = new ConfigValidationError({ message: "Missing required field: version" });
    reportConfigError(err, out);
    expect(errors.some((e) => e.includes("Missing required field: version"))).toBe(true);
  });

  it("includes path when present", () => {
    const { out, errors } = makeFakeOut();
    const err = new ConfigValidationError({
      message: "Invalid value",
      path: "gateProfiles.fast[0]",
    });
    reportConfigError(err, out);
    expect(errors.some((e) => e.includes("gateProfiles.fast[0]"))).toBe(true);
  });

  it("includes phax validate hint", () => {
    const { out, errors } = makeFakeOut();
    const err = new ConfigValidationError({ message: "some error" });
    reportConfigError(err, out);
    expect(errors.some((e) => e.includes("phax validate"))).toBe(true);
  });

  it("includes phax schema upgrade hint", () => {
    const { out, errors } = makeFakeOut();
    const err = new ConfigValidationError({ message: "some error" });
    reportConfigError(err, out);
    expect(errors.some((e) => e.includes("phax schema upgrade"))).toBe(true);
  });
});
