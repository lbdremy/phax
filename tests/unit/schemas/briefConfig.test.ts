import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { formatConfigParseError } from "../../../src/schemas/formatError.js";
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

const PUSH_REFUSAL = '  brief.push must be "findings" or "findings-and-rules"';

// The refusal lines a config layer gives for `raw`, or [] when it decodes.
function refusalOf(
  decode: typeof decodePhaxConfig | typeof decodePhaxUserOverlay,
  raw: unknown,
): readonly string[] {
  const decoded = decode(raw);
  return Either.isLeft(decoded) ? formatConfigParseError(raw, decoded.left).split("\n") : [];
}

describe("BriefConfigSchema", () => {
  it.each(["findings", "findings-and-rules"])("decodes a brief block pushing %s", (push) => {
    expect(decodeBriefConfig({ command: "node ./brief.mjs", push })).toEqual(
      Either.right({ command: "node ./brief.mjs", push }),
    );
  });

  it("refuses an empty command, a missing command and an extra key", () => {
    expect(Either.isLeft(decodeBriefConfig({ command: "", push: "findings" }))).toBe(true);
    expect(Either.isLeft(decodeBriefConfig({ push: "findings" }))).toBe(true);
    expect(
      Either.isLeft(decodeBriefConfig({ command: "brief", push: "findings", timeout: 5 })),
    ).toBe(true);
  });

  it("refuses a missing push and any other value: push has no default", () => {
    expect(Either.isLeft(decodeBriefConfig({ command: "node ./brief.mjs" }))).toBe(true);
    expect(Either.isLeft(decodeBriefConfig({ command: "node ./brief.mjs", push: "rules" }))).toBe(
      true,
    );
  });
});

describe("brief in phax.json", () => {
  it("decodes a config with a brief block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      brief: { command: "node ./brief.mjs", push: "findings" },
    });
    expect(Either.isRight(result) && result.right.brief).toEqual({
      command: "node ./brief.mjs",
      push: "findings",
    });
  });

  it("leaves brief undefined when absent", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result) && result.right.brief).toBeUndefined();
  });

  it("refuses an empty command and an extra key", () => {
    expect(
      Either.isLeft(
        decodePhaxConfig({ ...minimalValidPhaxConfig, brief: { command: "", push: "findings" } }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        decodePhaxConfig({
          ...minimalValidPhaxConfig,
          brief: { command: "b", push: "findings", extra: true },
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["no push", { command: "node ./brief.mjs" }],
    ["push rules", { command: "node ./brief.mjs", push: "rules" }],
  ])("refuses a brief with %s, naming brief.push and both values", (_name, brief) => {
    expect(refusalOf(decodePhaxConfig, { ...minimalValidPhaxConfig, brief })).toEqual([
      PUSH_REFUSAL,
    ]);
  });
});

describe("brief in the user overlay", () => {
  it("decodes an overlay with a brief block", () => {
    const result = decodePhaxUserOverlay({
      brief: { command: "node ./brief.mjs", push: "findings-and-rules" },
    });
    expect(Either.isRight(result) && result.right.brief?.push).toBe("findings-and-rules");
  });

  it("refuses an empty command and an extra key", () => {
    expect(Either.isLeft(decodePhaxUserOverlay({ brief: { command: "", push: "findings" } }))).toBe(
      true,
    );
    expect(
      Either.isLeft(decodePhaxUserOverlay({ brief: { command: "b", push: "findings", extra: 1 } })),
    ).toBe(true);
  });

  it.each([
    ["no push", { command: "node ./brief.mjs" }],
    ["push rules", { command: "node ./brief.mjs", push: "rules" }],
  ])("refuses a brief with %s, naming brief.push and both values", (_name, brief) => {
    expect(refusalOf(decodePhaxUserOverlay, { brief })).toEqual([PUSH_REFUSAL]);
  });
});
