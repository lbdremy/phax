import { describe, expect, it } from "vitest";
import { userConfigOf } from "../../../src/domain/records/userConfig.js";
import type { ProviderId } from "../../../src/schemas/providerId.js";
import type { UserConfig } from "../../../src/schemas/runRecord.js";

describe("userConfigOf", () => {
  const cases: ReadonlyArray<readonly [ProviderId, UserConfig]> = [
    ["claude-code", "excluded"],
    ["codex-cli", "loaded"],
    ["mistral-vibe", "loaded"],
  ];

  it.each(cases)("says %s is %s", (provider, expected) => {
    expect(userConfigOf(provider)).toBe(expected);
  });
});
