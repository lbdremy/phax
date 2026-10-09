import { describe, expect, it } from "vitest";
import { Either } from "effect";
import { encodeGateDiagnosticsFile } from "../../../src/schemas/gateDiagnostics.js";
import {
  currentSchemaUrl,
  readGateDiagnosticsAnswer,
  withSchemaUrl,
} from "../../../src/schemas/persisted.js";

// A document a gate step prints, stamped at the format's current stamp.
function printed(diagnostics: ReadonlyArray<object>) {
  return { $schema: currentSchemaUrl("gate-diagnostics"), diagnostics };
}

describe("the printed gate-diagnostics document", () => {
  it("decodes a valid invariant diagnostic", () => {
    const decoded = readGateDiagnosticsAnswer(
      printed([
        {
          rule: "no-unused-vars",
          class: "invariant",
          location: { file: "src/foo.ts", line: 12 },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ]),
    );
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("accepts a diagnostic without a line", () => {
    const decoded = readGateDiagnosticsAnswer(
      printed([
        {
          rule: "no-unused-vars",
          class: "invariant",
          location: { file: "src/foo.ts" },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ]),
    );
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("rejects a diagnostic missing repair", () => {
    const decoded = readGateDiagnosticsAnswer(
      printed([
        {
          rule: "no-unused-vars",
          class: "invariant",
          location: { file: "src/foo.ts" },
          message: "unused variable",
        },
      ]),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("accepts an empty diagnostics list", () => {
    const decoded = readGateDiagnosticsAnswer(printed([]));
    expect(decoded).toEqual(Either.right({ diagnostics: [] }));
  });

  it("decodes a valid completion diagnostic with the invariant's fields", () => {
    const completion = {
      rule: "wiring-incomplete",
      class: "completion" as const,
      location: { file: "src/foo.ts", line: 12 },
      message: "core not wired up",
      repair: "wire up core",
    };
    const decoded = readGateDiagnosticsAnswer(printed([completion]));
    expect(decoded).toEqual(Either.right({ diagnostics: [completion] }));
  });

  it("rejects a completion diagnostic missing repair", () => {
    const decoded = readGateDiagnosticsAnswer(
      printed([
        {
          rule: "wiring-incomplete",
          class: "completion",
          location: { file: "src/foo.ts", line: 12 },
          message: "core not wired up",
        },
      ]),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a diagnostic with no class", () => {
    const decoded = readGateDiagnosticsAnswer(
      printed([
        {
          rule: "no-unused-vars",
          location: { file: "src/foo.ts" },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ]),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a diagnostic with an unknown class", () => {
    const decoded = readGateDiagnosticsAnswer(
      printed([
        {
          rule: "no-unused-vars",
          class: "advisory",
          location: { file: "src/foo.ts" },
          message: "unused variable",
          repair: "remove the unused variable",
        },
      ]),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("round-trips an invariant diagnostic through the saved file", () => {
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
    const encoded = encodeGateDiagnosticsFile(withSchemaUrl("gate-diagnostics", document));
    expect(readGateDiagnosticsAnswer(encoded)).toEqual(Either.right(document));
  });

  it("round-trips a completion diagnostic through the saved file", () => {
    const document = {
      diagnostics: [
        {
          rule: "wiring-incomplete",
          class: "completion" as const,
          location: { file: "src/foo.ts" },
          message: "core not wired up",
          repair: "wire up core",
        },
      ],
    };
    const encoded = encodeGateDiagnosticsFile(withSchemaUrl("gate-diagnostics", document));
    expect(readGateDiagnosticsAnswer(encoded)).toEqual(Either.right(document));
  });
});
