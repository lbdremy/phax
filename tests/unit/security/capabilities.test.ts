import { describe, expect, it } from "vitest";
import type {
  CapabilitySupport,
  JailStrength,
  SecurityMark,
} from "../../../src/domain/security/capabilities.js";
import {
  PROVIDER_SECURITY_CAPABILITIES,
  VIBE_PARTIAL_SECURED_MESSAGE,
  evaluateProviderSecurity,
} from "../../../src/domain/security/capabilities.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";

// Compile-time checks: public API types are referenced in typed variables below.
const filesystemJailSample: JailStrength = "strong";
const capabilitySupportSample: CapabilitySupport = "supported";
const markSample: SecurityMark = "partial-filesystem";
void filesystemJailSample;
void capabilitySupportSample;
void markSample;

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: { allowRead: ["/repo"], allowWrite: ["/repo"] },
  network: { profile: "provider-only", allowDomains: ["api.anthropic.com"] },
  mcp: { mode: "disabled", allow: [] },
  failClosed: true,
};

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open", allowDomains: [] },
  mcp: { mode: "provider-default", allow: [] },
  failClosed: false,
};

describe("PROVIDER_SECURITY_CAPABILITIES", () => {
  it("claude-code has strong filesystem jail, supported network and MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["claude-code"];
    expect(cap.filesystemJail).toBe("strong");
    expect(cap.networkAllowlist).toBe("supported");
    expect(cap.mcpAllowlist).toBe("supported");
  });

  it("codex-cli has strong filesystem jail, supported network and MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["codex-cli"];
    expect(cap.filesystemJail).toBe("strong");
    expect(cap.networkAllowlist).toBe("supported");
    expect(cap.mcpAllowlist).toBe("supported");
  });

  it("mistral-vibe has partial filesystem jail, unsupported network allowlist, supported MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["mistral-vibe"];
    expect(cap.filesystemJail).toBe("partial");
    expect(cap.networkAllowlist).toBe("unsupported");
    expect(cap.mcpAllowlist).toBe("supported");
  });
});

describe("evaluateProviderSecurity — unsafe mode", () => {
  it("claude-code is satisfiable and not downgraded in unsafe mode", () => {
    const result = evaluateProviderSecurity("claude-code", unsafePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
    expect(result.marks).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it("codex-cli is satisfiable and not downgraded in unsafe mode", () => {
    const result = evaluateProviderSecurity("codex-cli", unsafePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
    expect(result.marks).toEqual([]);
  });

  it("mistral-vibe is satisfiable and not downgraded in unsafe mode", () => {
    const result = evaluateProviderSecurity("mistral-vibe", unsafePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
    expect(result.marks).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});

describe("evaluateProviderSecurity — secure mode, claude-code", () => {
  it("satisfies strict security", () => {
    const result = evaluateProviderSecurity("claude-code", securePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
  });

  it("has no marks", () => {
    const result = evaluateProviderSecurity("claude-code", securePolicy);
    expect(result.marks).toEqual([]);
  });

  it("has no notes", () => {
    const result = evaluateProviderSecurity("claude-code", securePolicy);
    expect(result.notes).toEqual([]);
  });

  it("carries the provider through", () => {
    const result = evaluateProviderSecurity("claude-code", securePolicy);
    expect(result.provider).toBe("claude-code");
  });
});

describe("evaluateProviderSecurity — secure mode, codex-cli", () => {
  it("satisfies strict security", () => {
    const result = evaluateProviderSecurity("codex-cli", securePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
  });

  it("has no marks or notes", () => {
    const result = evaluateProviderSecurity("codex-cli", securePolicy);
    expect(result.marks).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});

describe("evaluateProviderSecurity — secure mode, mistral-vibe", () => {
  it("does not satisfy strict security", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.satisfiesStrict).toBe(false);
  });

  it("is marked as downgraded", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.downgraded).toBe(true);
  });

  it("carries partial-filesystem and network-unenforced marks", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.marks).toContain("partial-filesystem");
    expect(result.marks).toContain("network-unenforced");
  });

  it("includes the partial-secured message in notes", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.notes).toContain(VIBE_PARTIAL_SECURED_MESSAGE);
  });
});

describe("evaluateProviderSecurity — secure mode, network profile interaction", () => {
  it("claude-code with open network profile still satisfies strict (network allowlist supported)", () => {
    const openNetworkPolicy: SecurityPolicy = {
      ...securePolicy,
      network: { profile: "open", allowDomains: [] },
    };
    const result = evaluateProviderSecurity("claude-code", openNetworkPolicy);
    expect(result.satisfiesStrict).toBe(true);
  });

  it("mistral-vibe with open network profile still has network-unenforced mark", () => {
    const openNetworkPolicy: SecurityPolicy = {
      ...securePolicy,
      network: { profile: "open", allowDomains: [] },
    };
    const result = evaluateProviderSecurity("mistral-vibe", openNetworkPolicy);
    expect(result.marks).toContain("network-unenforced");
  });
});
