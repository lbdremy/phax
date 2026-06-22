import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  PublishConfigSchema,
  resolvePublishConfig,
  decodePhaxConfig,
} from "../../../src/schemas/phaxConfig.js";
import { Schema } from "effect";

const decodePublishConfig = Schema.decodeUnknownEither(PublishConfigSchema, {
  onExcessProperty: "error",
});

const minimalValidPhaxConfig = {
  version: 1,
  name: "test",
  state: { root: ".phax" },
  gateProfiles: { full: ["pnpm test"] },
} as const;

describe("PublishConfigSchema", () => {
  it("decodes a full publish config", () => {
    const result = decodePublishConfig({
      enabled: true,
      remote: "upstream",
      provider: "github",
      pushBranch: false,
      createPullRequest: true,
      baseBranch: "main",
      title: "My PR",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.enabled).toBe(true);
      expect(result.right.remote).toBe("upstream");
      expect(result.right.baseBranch).toBe("main");
      expect(result.right.title).toBe("My PR");
    }
  });

  it("decodes a minimal publish config (only enabled)", () => {
    const result = decodePublishConfig({ enabled: false });
    expect(Either.isRight(result)).toBe(true);
  });

  it("rejects a non-github provider", () => {
    const result = decodePublishConfig({ enabled: true, provider: "gitlab" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = decodePublishConfig({ enabled: true, unknownKey: "value" });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("resolvePublishConfig", () => {
  it("returns disabled defaults when undefined", () => {
    const resolved = resolvePublishConfig(undefined);
    expect(resolved.enabled).toBe(false);
    expect(resolved.remote).toBe("origin");
    expect(resolved.provider).toBe("github");
    expect(resolved.pushBranch).toBe(true);
    expect(resolved.createPullRequest).toBe(true);
    expect(resolved.baseBranch).toBeUndefined();
    expect(resolved.title).toBeUndefined();
  });

  it("applies defaults for missing optional fields", () => {
    const resolved = resolvePublishConfig({ enabled: true });
    expect(resolved.enabled).toBe(true);
    expect(resolved.remote).toBe("origin");
    expect(resolved.provider).toBe("github");
    expect(resolved.pushBranch).toBe(true);
    expect(resolved.createPullRequest).toBe(true);
  });

  it("preserves all provided fields", () => {
    const resolved = resolvePublishConfig({
      enabled: true,
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
      publish: { enabled: true, remote: "origin" },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.publish?.enabled).toBe(true);
    }
  });

  it("decodes phax.json without publish block", () => {
    const result = decodePhaxConfig(minimalValidPhaxConfig);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.publish).toBeUndefined();
    }
  });

  it("rejects publish block with non-github provider", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      publish: { enabled: true, provider: "bitbucket" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects publish block with unknown key", () => {
    const result = decodePhaxConfig({
      ...minimalValidPhaxConfig,
      publish: { enabled: true, bogus: "value" },
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});
