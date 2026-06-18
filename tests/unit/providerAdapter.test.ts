import { describe, expect, it } from "vitest";
import { providerToAdapter } from "../../src/domain/providerAdapter.js";

describe("providerToAdapter", () => {
  it("maps claude-code to claude", () => {
    expect(providerToAdapter("claude-code")).toBe("claude");
  });

  it("maps codex-cli to codex", () => {
    expect(providerToAdapter("codex-cli")).toBe("codex");
  });

  it("maps mistral-vibe to mistral", () => {
    expect(providerToAdapter("mistral-vibe")).toBe("mistral");
  });

  it("is exhaustive over all ProviderId values", () => {
    const providers = ["claude-code", "codex-cli", "mistral-vibe"] as const;
    const adapters = providers.map(providerToAdapter);
    expect(adapters).toEqual(["claude", "codex", "mistral"]);
  });
});
