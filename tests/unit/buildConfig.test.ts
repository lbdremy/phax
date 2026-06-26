import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { buildPhaxConfig, type WizardAnswers } from "../../src/domain/init/buildConfig.js";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";

const baseAnswers: WizardAnswers = {
  name: "my-project",
  gateCommands: ["pnpm typecheck", "pnpm test:unit"],
  complianceEnabled: false,
  publishAuto: false,
  publishPushBranch: true,
  publishCreatePr: true,
};

describe("buildPhaxConfig", () => {
  it("writes version 1, $schema ref, and name at top level", () => {
    const config = buildPhaxConfig(baseAnswers);
    expect(config.version).toBe(1);
    expect(config.$schema).toBe("./phax.schema.json");
    expect(config.name).toBe("my-project");
  });

  it("does not include a state block", () => {
    const config = buildPhaxConfig(baseAnswers);
    expect(config.state).toBeUndefined();
  });

  it("does not include project or type keys", () => {
    const config = buildPhaxConfig(baseAnswers) as Record<string, unknown>;
    expect(config["project"]).toBeUndefined();
    expect(config["type"]).toBeUndefined();
  });

  it("places gate commands in the fast profile", () => {
    const config = buildPhaxConfig(baseAnswers);
    expect(config.gateProfiles["fast"]).toEqual(["pnpm typecheck", "pnpm test:unit"]);
  });

  it("falls back to placeholder when gateCommands is empty", () => {
    const config = buildPhaxConfig({ ...baseAnswers, gateCommands: [] });
    expect(config.gateProfiles["fast"]).toEqual([
      "echo 'replace with your gate commands in phax.json'",
    ]);
  });

  it("omits review when compliance is disabled", () => {
    const config = buildPhaxConfig({ ...baseAnswers, complianceEnabled: false });
    expect(config.review).toBeUndefined();
  });

  it("includes review.compliance.enabled when compliance is enabled", () => {
    const config = buildPhaxConfig({ ...baseAnswers, complianceEnabled: true });
    expect(config.review?.compliance?.enabled).toBe(true);
  });

  it("omits publish when publishAuto is false", () => {
    const config = buildPhaxConfig({ ...baseAnswers, publishAuto: false });
    expect(config.publish).toBeUndefined();
  });

  it("includes publish with correct toggles when publishAuto is true", () => {
    const config = buildPhaxConfig({
      ...baseAnswers,
      publishAuto: true,
      publishPushBranch: true,
      publishCreatePr: false,
    });
    expect(config.publish?.auto).toBe(true);
    expect(config.publish?.pushBranch).toBe(true);
    expect(config.publish?.createPullRequest).toBe(false);
  });

  it("output decodes cleanly through decodePhaxConfig", () => {
    const config = buildPhaxConfig(baseAnswers);
    const decoded = decodePhaxConfig(config);
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("output with all toggles on also decodes cleanly", () => {
    const config = buildPhaxConfig({
      ...baseAnswers,
      complianceEnabled: true,
      publishAuto: true,
      publishPushBranch: true,
      publishCreatePr: true,
    });
    const decoded = decodePhaxConfig(config);
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("output with empty commands also decodes cleanly", () => {
    const config = buildPhaxConfig({ ...baseAnswers, gateCommands: [] });
    const decoded = decodePhaxConfig(config);
    expect(Either.isRight(decoded)).toBe(true);
  });
});
