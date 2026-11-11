import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  PublishConfigSchema,
  resolvePublishConfig,
  decodePhaxConfig,
} from "../../../src/schemas/phaxConfig.js";
import { Schema } from "effect";

const decodePublishConfig = Schema.decodeUnknownResult(PublishConfigSchema, {
  onExcessProperty: "error",
  reportInput: true,
});

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  state: { root: ".phax" },
  gateProfiles: { full: [{ command: "pnpm test", surface: "local", firing: "every-phase" }] },
} as const;

describe("PublishConfigSchema", () => {
  it("decodes a full publish config", () => {
    const result = decodePublishConfig({
      auto: true,
      remote: "upstream",
      provider: "github",
      pushBranch: false,
      createPullRequest: true,
      baseBranch: "main",
      title: "My PR",
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.auto).toBe(true);
      expect(result.success.remote).toBe("upstream");
      expect(result.success.baseBranch).toBe("main");
      expect(result.success.title).toBe("My PR");
    }
  });

  it("decodes a minimal publish config (only auto)", () => {
    const result = decodePublishConfig({ auto: false });
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("rejects a non-github provider", () => {
    const result = decodePublishConfig({ auto: true, provider: "gitlab" });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = decodePublishConfig({ auto: true, unknownKey: "value" });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects publish block using legacy enabled key", () => {
    const result = decodePublishConfig({ enabled: true });
    expect(Result.isFailure(result)).toBe(true);
  });
});

describe("resolvePublishConfig", () => {
  it("returns defaults when undefined", () => {
    const resolved = resolvePublishConfig(undefined);
    expect(resolved.auto).toBe(false);
    expect(resolved.remote).toBe("origin");
    expect(resolved.provider).toBe("github");
    expect(resolved.pushBranch).toBe(true);
    expect(resolved.createPullRequest).toBe(true);
    expect(resolved.baseBranch).toBeUndefined();
    expect(resolved.title).toBeUndefined();
  });

  it("applies defaults for missing optional fields", () => {
    const resolved = resolvePublishConfig({ auto: true });
    expect(resolved.auto).toBe(true);
    expect(resolved.remote).toBe("origin");
    expect(resolved.provider).toBe("github");
    expect(resolved.pushBranch).toBe(true);
    expect(resolved.createPullRequest).toBe(true);
  });

  it("preserves all provided fields", () => {
    const resolved = resolvePublishConfig({
      auto: true,
      remote: "upstream",
      provider: "github",
      pushBranch: false,
      createPullRequest: false,
      baseBranch: "develop",
      title: "Feature PR",
    });
    expect(resolved.remote).toBe("upstream");
    expect(resolved.pushBranch).toBe(false);
    expect(resolved.createPullRequest).toBe(false);
    expect(resolved.baseBranch).toBe("develop");
    expect(resolved.title).toBe("Feature PR");
  });
});

describe("PhaxConfigSchema with publish block", () => {
  it("decodes phax.json with publish block present", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      publish: { auto: true, remote: "origin" },
    });
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.publish?.auto).toBe(true);
    }
  });

  it("decodes phax.json without publish block", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success.publish).toBeUndefined();
    }
  });

  it("rejects publish block with non-github provider", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      publish: { auto: true, provider: "bitbucket" },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects publish block with unknown key", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      publish: { auto: true, bogus: "value" },
    });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects publish block using legacy enabled key", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      publish: { enabled: true },
    });
    expect(Result.isFailure(result)).toBe(true);
  });
});
