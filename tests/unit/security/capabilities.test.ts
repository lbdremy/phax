import { describe, expect, it } from "vitest";
import type {
  CapabilitySupport,
  CommandEnforcement,
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
const commandEnforcementSample: CommandEnforcement = "prefix";
void filesystemJailSample;
void capabilitySupportSample;
void markSample;
void commandEnforcementSample;

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: { allowRead: ["/repo"], allowWrite: ["/repo"], allowWriteProtected: [] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  failClosed: true,
};

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [], allowWriteProtected: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  failClosed: false,
};

describe("PROVIDER_SECURITY_CAPABILITIES", () => {
  it("claude-code has strong filesystem jail and supported MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["claude-code"];
    expect(cap.filesystemJail).toBe("strong");
    expect(cap.mcpAllowlist).toBe("supported");
  });

  it("codex-cli has strong filesystem jail and supported MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["codex-cli"];
    expect(cap.filesystemJail).toBe("strong");
    expect(cap.mcpAllowlist).toBe("supported");
  });

  it("mistral-vibe has partial filesystem jail and supported MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["mistral-vibe"];
    expect(cap.filesystemJail).toBe("partial");
    expect(cap.mcpAllowlist).toBe("supported");
  });

  it("claude-code has prefix command enforcement", () => {
    expect(PROVIDER_SECURITY_CAPABILITIES["claude-code"].commandEnforcement).toBe("prefix");
  });

  it("codex-cli has none command enforcement", () => {
    expect(PROVIDER_SECURITY_CAPABILITIES["codex-cli"].commandEnforcement).toBe("none");
  });

  it("mistral-vibe has none command enforcement", () => {
    expect(PROVIDER_SECURITY_CAPABILITIES["mistral-vibe"].commandEnforcement).toBe("none");
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
  it("does not satisfy strict security (partial filesystem jail)", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.satisfiesStrict).toBe(false);
  });

  it("is marked as downgraded", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.downgraded).toBe(true);
  });

  it("carries the partial-filesystem mark", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.marks).toContain("partial-filesystem");
  });

  it("includes the partial-secured message in notes", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.notes).toContain(VIBE_PARTIAL_SECURED_MESSAGE);
  });
});

describe("evaluateProviderSecurity — secure mode, network profile interaction", () => {
  it("strict satisfaction is independent of network profile (no domain allowlist exists)", () => {
    const openNetworkPolicy: SecurityPolicy = {
      ...securePolicy,
      network: { profile: "open" },
    };
    // A strong filesystem jail is the only gate; the network profile does not
    // change whether a provider satisfies strict secure mode.
    expect(evaluateProviderSecurity("claude-code", openNetworkPolicy).satisfiesStrict).toBe(true);
    expect(evaluateProviderSecurity("codex-cli", openNetworkPolicy).satisfiesStrict).toBe(true);
  });

  it("mistral-vibe stays downgraded under any network profile", () => {
    const openNetworkPolicy: SecurityPolicy = {
      ...securePolicy,
      network: { profile: "open" },
    };
    const result = evaluateProviderSecurity("mistral-vibe", openNetworkPolicy);
    expect(result.satisfiesStrict).toBe(false);
    expect(result.marks).toContain("partial-filesystem");
  });
});

describe("evaluateProviderSecurity — commandEnforcement does not affect strictness", () => {
  it("codex-cli (commandEnforcement:none) still satisfies strict in secure mode", () => {
    const result = evaluateProviderSecurity("codex-cli", securePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
  });

  it("mistral-vibe strictness is driven by filesystemJail, not commandEnforcement", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    // downgraded because of partial filesystem jail, not commandEnforcement
    expect(result.satisfiesStrict).toBe(false);
    expect(result.marks).toContain("partial-filesystem");
    expect(result.marks).not.toContain("command-precision");
  });
});
