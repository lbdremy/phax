import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeGateDiagnosticsDocument,
  encodeGateDiagnosticsDocument,
} from "../../../src/schemas/gateDiagnostics.js";

describe("decodeGateDiagnosticsDocument", () => {
  it("decodes a valid invariant diagnostic", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "no-unused-vars",
          class: "invariant",
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
          class: "invariant",
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
          class: "invariant",
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

  it("decodes a valid completion diagnostic with scopes", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "wiring-incomplete",
          class: "completion",
          scopes: ["core"],
          location: { file: "src/foo.ts", line: 12 },
          message: "core not wired up",
          repair: "wire up core",
        },
      ],
    });
    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right.diagnostics[0]?.class).toBe("completion");
    }
  });

  it("rejects a completion diagnostic without scopes", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "wiring-incomplete",
          class: "completion",
          location: { file: "src/foo.ts", line: 12 },
          message: "core not wired up",
          repair: "wire up core",
        },
      ],
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a completion diagnostic with an empty scopes list", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "wiring-incomplete",
          class: "completion",
          scopes: [],
          location: { file: "src/foo.ts", line: 12 },
          message: "core not wired up",
          repair: "wire up core",
        },
      ],
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a diagnostic with no class", () => {
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
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a diagnostic with an unknown class", () => {
    const decoded = decodeGateDiagnosticsDocument({
      diagnostics: [
        {
          rule: "no-unused-vars",
          class: "advisory",
          location: { file: "src/foo.ts" },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ],
    });
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("round-trips an invariant diagnostic through encode", () => {
    const document = {
      diagnostics: [
        {
          rule: "no-unused-vars",
          class: "invariant" as const,
          location: { file: "src/foo.ts", line: 12 },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ],
    };
    const encoded = encodeGateDiagnosticsDocument(document);
    expect(decodeGateDiagnosticsDocument(encoded)).toEqual(Either.right(document));
  });

  it("round-trips a completion diagnostic through encode", () => {
    const document = {
      diagnostics: [
        {
          rule: "wiring-incomplete",
          class: "completion" as const,
          scopes: ["core", "adapters"] as const,
          location: { file: "src/foo.ts" },
          message: "core not wired up",
          repair: "wire up core",
        },
      ],
    };
    const encoded = encodeGateDiagnosticsDocument(document);
    expect(decodeGateDiagnosticsDocument(encoded)).toEqual(Either.right(document));
  });
});
