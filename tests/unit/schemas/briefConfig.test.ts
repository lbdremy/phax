import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { formatConfigParseError } from "../../../src/schemas/formatError.js";
import {
  BriefConfigSchema,
  decodePhaxConfig,
  decodePhaxUserOverlay,
} from "../../../src/schemas/phaxConfig.js";

const decodeBriefConfig = Schema.decodeUnknownResult(BriefConfigSchema, {
  onExcessProperty: "error",
  reportInput: true,
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
  return Result.isFailure(decoded) ? formatConfigParseError(raw, decoded.failure).split("\n") : [];
}

describe("BriefConfigSchema", () => {
  it.each(["findings", "findings-and-rules"])("decodes a brief block pushing %s", (push) => {
    expect(decodeBriefConfig({ command: "node ./brief.mjs", push })).toEqual(
      Result.succeed({ command: "node ./brief.mjs", push }),
    );
  });

  it("refuses an empty command, a missing command and an extra key", () => {
    expect(Result.isFailure(decodeBriefConfig({ command: "", push: "findings" }))).toBe(true);
    expect(Result.isFailure(decodeBriefConfig({ push: "findings" }))).toBe(true);
    expect(
      Result.isFailure(decodeBriefConfig({ command: "brief", push: "findings", timeout: 5 })),
    ).toBe(true);
  });

  it("refuses a missing push and any other value: push has no default", () => {
    expect(Result.isFailure(decodeBriefConfig({ command: "node ./brief.mjs" }))).toBe(true);
    expect(
      Result.isFailure(decodeBriefConfig({ command: "node ./brief.mjs", push: "rules" })),
    ).toBe(true);
  });
});

describe("brief in phax.json", () => {
  it("decodes a config with a brief block", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      brief: { command: "node ./brief.mjs", push: "findings" },
    });
    expect(Result.isSuccess(result) && result.success.brief).toEqual({
      command: "node ./brief.mjs",
      push: "findings",
    });
  });

  it("leaves brief undefined when absent", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Result.isSuccess(result) && result.success.brief).toBeUndefined();
  });

  it("refuses an empty command and an extra key", () => {
    expect(
      Result.isFailure(
        decodePhaxConfig({ ...minimalValidPhaxConfig, brief: { command: "", push: "findings" } }),
      ),
    ).toBe(true);
    expect(
      Result.isFailure(
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

  it("names brief.push when command is missing too", () => {
    expect(refusalOf(decodePhaxConfig, { ...minimalValidPhaxConfig, brief: {} })).toEqual([
      "  brief.command: is missing",
      PUSH_REFUSAL,
    ]);
  });

  it("keeps the block's description out of a type refusal", () => {
    const lines = refusalOf(decodePhaxConfig, {
      ...minimalValidPhaxConfig,
      brief: "node ./brief.mjs",
    });
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toContain("The brief provider:");
  });
});

describe("brief in the user overlay", () => {
  it("decodes an overlay with a brief block", () => {
    const result = decodePhaxUserOverlay({
      brief: { command: "node ./brief.mjs", push: "findings-and-rules" },
    });
    expect(Result.isSuccess(result) && result.success.brief?.push).toBe("findings-and-rules");
  });

  it("refuses an empty command and an extra key", () => {
    expect(
      Result.isFailure(decodePhaxUserOverlay({ brief: { command: "", push: "findings" } })),
    ).toBe(true);
    expect(
      Result.isFailure(
        decodePhaxUserOverlay({ brief: { command: "b", push: "findings", extra: 1 } }),
      ),
    ).toBe(true);
  });

  it.each([
    ["no push", { command: "node ./brief.mjs" }],
    ["push rules", { command: "node ./brief.mjs", push: "rules" }],
  ])("refuses a brief with %s, naming brief.push and both values", (_name, brief) => {
    expect(refusalOf(decodePhaxUserOverlay, { brief })).toEqual([PUSH_REFUSAL]);
  });
});
