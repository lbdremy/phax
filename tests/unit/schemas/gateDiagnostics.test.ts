import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { decodeGateDiagnosticsDocument } from "../../../src/schemas/gateDiagnostics.js";

describe("decodeGateDiagnosticsDocument", () => {
  it("decodes a valid document", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "no-unused-vars",
          location: { file: "src/foo.ts", line: 12 },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ],
    });
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("accepts a diagnostic without a line", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "no-unused-vars",
          location: { file: "src/foo.ts" },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ],
    });
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("rejects a diagnostic missing repair", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "no-unused-vars",
          location: { file: "src/foo.ts" },
          message: "unused variable",
        },
      ],
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("accepts an empty diagnostics list", () => {
    const decoded = decodeGateDiagnosticsDocument({ diagnostics: [] });
    expect(Either.isRight(decoded)).toBe(true);
  });
});
