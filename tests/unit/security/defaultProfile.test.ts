import { describe, it, expect } from "vitest";
import { DEFAULT_SECURITY_PROFILE } from "../../../src/schemas/securityConfig.js";

describe("default security profile", () => {
  it("defaults to secure mode", () => {
    expect(DEFAULT_SECURITY_PROFILE).toBe("secure");
  });

  it("is a valid SecurityMode value", () => {
    const validModes: string[] = ["secure", "unsafe", "isolated"];
    expect(validModes).toContain(DEFAULT_SECURITY_PROFILE);
  });
});
