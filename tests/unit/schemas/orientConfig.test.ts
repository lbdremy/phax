import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  OrientConfigSchema,
  decodePhaxConfig,
  decodePhaxUserOverlay,
} from "../../../src/schemas/phaxConfig.js";

const decodeOrientConfig = Schema.decodeUnknownEither(OrientConfigSchema, {
  onExcessProperty: "error",
});

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  gateProfiles: { full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
} as const;

describe("OrientConfigSchema", () => {
  it("decodes a valid orient block", () => {
    const result = decodeOrientConfig({ command: "orient-provider" });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.command).toBe("orient-provider");
    }
  });

  it("rejects an empty command", () => {
    const result = decodeOrientConfig({ command: "" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the block", () => {
    const result = decodeOrientConfig({ command: "orient-provider", extra: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxConfigSchema orient block", () => {
  it("decodes a config with an orient block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      orient: { command: "orient-provider" },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.orient?.command).toBe("orient-provider");
    }
  });

  it("resolves to undefined when the orient block is absent", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.orient).toBeUndefined();
    }
  });

  it("rejects an empty command in the orient block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      orient: { command: "" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the orient block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      orient: { command: "orient-provider", extra: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("PhaxUserOverlaySchema orient block", () => {
  it("decodes an overlay with an orient block", () => {
    const result = decodePhaxUserOverlay({ orient: { command: "orient-provider" } });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.orient?.command).toBe("orient-provider");
    }
  });

  it("resolves to undefined when the orient block is absent", () => {
    const result = decodePhaxUserOverlay({});
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.orient).toBeUndefined();
    }
  });

  it("rejects an empty command in the overlay orient block", () => {
    const result = decodePhaxUserOverlay({ orient: { command: "" } });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects an excess property inside the overlay orient block", () => {
    const result = decodePhaxUserOverlay({
      orient: { command: "orient-provider", extra: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
