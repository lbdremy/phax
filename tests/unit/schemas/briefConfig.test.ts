import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BriefConfigSchema,
  decodePhaxConfig,
  decodePhaxUserOverlay,
} from "../../../src/schemas/phaxConfig.js";

const decodeBriefConfig = Schema.decodeUnknownEither(BriefConfigSchema, {
  onExcessProperty: "error",
});

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  gateProfiles: { full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
} as const;

describe("BriefConfigSchema", () => {
  it("decodes a brief block", () => {
    expect(decodeBriefConfig({ command: "node ./brief.mjs" })).toEqual(
      Either.right({ command: "node ./brief.mjs" }),
    );
  });

  it("refuses an empty command, a missing command and an extra key", () => {
    expect(Either.isLeft(decodeBriefConfig({ command: "" }))).toBe(true);
    expect(Either.isLeft(decodeBriefConfig({}))).toBe(true);
    expect(Either.isLeft(decodeBriefConfig({ command: "brief", timeout: 5 }))).toBe(true);
  });
});

describe("brief in phax.json", () => {
  it("decodes a config with a brief block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      brief: { command: "node ./brief.mjs" },
    });
    expect(Either.isRight(result) && result.right.brief?.command).toBe("node ./brief.mjs");
  });

  it("leaves brief undefined when absent", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result) && result.right.brief).toBeUndefined();
  });

  it("refuses an empty command and an extra key", () => {
    expect(
      Either.isLeft(decodePhaxConfig({ ...minimalValidPhaxConfig, brief: { command: "" } })),
    ).toBe(true);
    expect(
      Either.isLeft(
        decodePhaxConfig({ ...minimalValidPhaxConfig, brief: { command: "b", extra: true } }),
      ),
    ).toBe(true);
  });
});

describe("brief in the user overlay", () => {
  it("decodes an overlay with a brief block", () => {
    const result = decodePhaxUserOverlay({ brief: { command: "node ./brief.mjs" } });
    expect(Either.isRight(result) && result.right.brief?.command).toBe("node ./brief.mjs");
  });

  it("refuses an empty command and an extra key", () => {
    expect(Either.isLeft(decodePhaxUserOverlay({ brief: { command: "" } }))).toBe(true);
    expect(Either.isLeft(decodePhaxUserOverlay({ brief: { command: "b", extra: 1 } }))).toBe(true);
  });
});
