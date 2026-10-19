import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_CONFIG } from "../../../src/domain/routing/defaults.js";
import {
  PHASE_MODEL_POLICY,
  phaseModelPolicyFindings,
  type PhaseModelPolicy,
} from "../../../src/domain/routing/phaseModelPolicy.js";

describe("phaseModelPolicyFindings", () => {
  it("finds nothing for the shipped policy against the shipped catalog", () => {
    expect(phaseModelPolicyFindings(PHASE_MODEL_POLICY, DEFAULT_PROVIDER_CONFIG)).toEqual([]);
  });

  it("names a default model the catalog does not list", () => {
    const policy: PhaseModelPolicy = {
      ...PHASE_MODEL_POLICY,
      defaultAssignment: { model: "claude-sonnet-9", effort: "medium" },
    };
    const findings = phaseModelPolicyFindings(policy, DEFAULT_PROVIDER_CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("claude-sonnet-9");
    expect(findings[0]).toContain("default");
  });

  it("names a default effort the default model does not support", () => {
    const policy: PhaseModelPolicy = {
      ...PHASE_MODEL_POLICY,
      defaultAssignment: { model: "claude-sonnet-5-5", effort: "ultra" },
    };
    const findings = phaseModelPolicyFindings(policy, DEFAULT_PROVIDER_CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("ultra");
    expect(findings[0]).toContain("claude-sonnet-5-5");
  });

  it("names an absent stronger model with its role", () => {
    const policy: PhaseModelPolicy = {
      ...PHASE_MODEL_POLICY,
      stronger: { model: "claude-opus-9" },
    };
    expect(phaseModelPolicyFindings(policy, DEFAULT_PROVIDER_CONFIG)).toEqual([
      "stronger model claude-opus-9 is not in the catalog",
    ]);
  });

  it("names an absent lighter model with its role", () => {
    const policy: PhaseModelPolicy = {
      ...PHASE_MODEL_POLICY,
      lighter: { model: "claude-haiku-9" },
    };
    expect(phaseModelPolicyFindings(policy, DEFAULT_PROVIDER_CONFIG)).toEqual([
      "lighter model claude-haiku-9 is not in the catalog",
    ]);
  });
});
