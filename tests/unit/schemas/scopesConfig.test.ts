import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ScopesConfigSchema,
  decodePhaxConfig,
  decodePhaxUserOverlay,
} from "../../../src/schemas/phaxConfig.js";

const decodeScopesConfig = Schema.decodeUnknownEither(ScopesConfigSchema, {
  onExcessProperty: "error",
});

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  gateProfiles: { full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
} as const;

describe("ScopesConfigSchema", () => {
  it("decodes a valid scopes block", () => {
    const result = decodeScopesConfig({ command: "scopes-provider" });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.command).toBe("scopes-provider");
    }
  });

  it("rejects an empty command", () => {
    const result = decodeScopesConfig({ command: "" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the block", () => {
    const result = decodeScopesConfig({ command: "scopes-provider", extra: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxConfigSchema scopes block", () => {
  it("decodes a config with a scopes block next to orient", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      orient: { command: "orient-provider" },
      scopes: { command: "scopes-provider" },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.scopes?.command).toBe("scopes-provider");
    }
  });

  it("resolves to undefined when the scopes block is absent", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.scopes).toBeUndefined();
    }
  });

  it("rejects an empty command in the scopes block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      scopes: { command: "" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the scopes block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      scopes: { command: "scopes-provider", extra: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxUserOverlaySchema scopes block", () => {
  it("decodes an overlay with a scopes block", () => {
    const result = decodePhaxUserOverlay({ scopes: { command: "scopes-provider" } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.scopes?.command).toBe("scopes-provider");
    }
  });

  it("resolves to undefined when the scopes block is absent", () => {
    const result = decodePhaxUserOverlay({});
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.scopes).toBeUndefined();
    }
  });

  it("rejects an empty command in the overlay scopes block", () => {
    const result = decodePhaxUserOverlay({ scopes: { command: "" } });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the overlay scopes block", () => {
    const result = decodePhaxUserOverlay({
      scopes: { command: "scopes-provider", extra: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
