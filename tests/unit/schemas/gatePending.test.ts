import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeGatePendingFile,
  encodeGatePendingFile,
  type GatePendingDocument,
} from "../../../src/schemas/gatePending.js";
import { withSchemaUrl } from "../../../src/schemas/persisted.js";

function stamped<T extends object>(value: T) {
  return withSchemaUrl("gate-pending", value);
}

const document: GatePendingDocument = {
  closed: ["core"],
  steps: [
    {
      command: "pnpm audit:diagnostics",
      pending: [
        {
          diagnostic: {
            class: "completion",
            scopes: ["adapters"],
            rule: "wired",
            location: { file: "src/a.ts" },
            message: "not wired yet",
            repair: "wire it up",
          },
          openScopes: ["adapters"],
        },
      ],
    },
  ],
};

describe("GatePendingFileSchema", () => {
  it("round-trips a document through encode/decode, $schema first", () => {
    const encoded = encodeGatePendingFile(stamped(document));
    expect(Object.keys(encoded)[0]).toBe("$schema");
    const decoded = decodeGatePendingFile(encoded);

    expect(Either.isRight(decoded)).toBe(true);
    if (Either.isRight(decoded)) {
      expect(decoded.right).toEqual(stamped(document));
    }
  });

  it("decodes an empty steps list", () => {
    const decoded = decodeGatePendingFile(stamped({ closed: [], steps: [] }));
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("rejects a document without $schema", () => {
    expect(Either.isLeft(decodeGatePendingFile({ closed: [], steps: [] }))).toBe(true);
  });

  it("rejects a step with an empty pending list", () => {
    const decoded = decodeGatePendingFile(
      stamped({
        closed: [],
        steps: [{ command: "pnpm audit:diagnostics", pending: [] }],
      }),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects a pending diagnostic with an empty openScopes list", () => {
    const decoded = decodeGatePendingFile(
      stamped({
        closed: [],
        steps: [
          {
            command: "pnpm audit:diagnostics",
            pending: [
              {
                diagnostic: document.steps[0]?.pending[0]?.diagnostic,
                openScopes: [],
              },
            ],
          },
        ],
      }),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });

  it("rejects an invariant diagnostic inside pending", () => {
    const decoded = decodeGatePendingFile(
      stamped({
        closed: [],
        steps: [
          {
            command: "pnpm audit:diagnostics",
            pending: [
              {
                diagnostic: {
                  class: "invariant",
                  rule: "no-any",
                  location: { file: "src/a.ts" },
                  message: "uses any",
                  repair: "add a type",
                },
                openScopes: ["adapters"],
              },
            ],
          },
        ],
      }),
    );
    expect(Either.isLeft(decoded)).toBe(true);
  });
});
