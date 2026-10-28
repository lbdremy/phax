import { describe, expect, it } from "vitest";
import type {
  CapabilitySupport,
  CommandEnforcement,
  JailStrength,
  SecurityMark,
} from "../../../src/domain/security/capabilities.js";
import {
  PROVIDER_SECURITY_CAPABILITIES,
  evaluateProviderSecurity,
  securityFilterFor,
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
  filesystem: { allowRead: ["/repo"], allowWrite: ["/repo"] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
  failClosed: true,
};

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],
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

  it("mistral-vibe has strong filesystem jail and supported MCP allowlist", () => {
    const cap = PROVIDER_SECURITY_CAPABILITIES["mistral-vibe"];
    expect(cap.filesystemJail).toBe("strong");
    expect(cap.mcpAllowlist).toBe("supported");
  });

  it("claude-code has prefix command enforcement", () => {
    expect(PROVIDER_SECURITY_CAPABILITIES["claude-code"].commandEnforcement).toBe("prefix");
  });

  it("codex-cli has none command enforcement", () => {
    expect(PROVIDER_SECURITY_CAPABILITIES["codex-cli"].commandEnforcement).toBe("none");
  });

  it("mistral-vibe has prefix command enforcement", () => {
    expect(PROVIDER_SECURITY_CAPABILITIES["mistral-vibe"].commandEnforcement).toBe("prefix");
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
  it("satisfies strict security and is not downgraded", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
  });

  it("has no marks or notes", () => {
    const result = evaluateProviderSecurity("mistral-vibe", securePolicy);
    expect(result.marks).toEqual([]);
    expect(result.notes).toEqual([]);
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
    expect(evaluateProviderSecurity("mistral-vibe", openNetworkPolicy).satisfiesStrict).toBe(true);
  });
});

describe("evaluateProviderSecurity — commandEnforcement does not affect strictness", () => {
  it("codex-cli (commandEnforcement:none) still satisfies strict in secure mode", () => {
    const result = evaluateProviderSecurity("codex-cli", securePolicy);
    expect(result.satisfiesStrict).toBe(true);
    expect(result.downgraded).toBe(false);
  });
});

describe("securityFilterFor", () => {
  it("allows every provider outside secure mode", () => {
    const filter = securityFilterFor(unsafePolicy);
    expect(filter("claude-code")).toEqual({ allowed: true });
    expect(filter("codex-cli")).toEqual({ allowed: true });
    expect(filter("mistral-vibe")).toEqual({ allowed: true });
  });

  it("in secure mode allows every provider, each holding a strong jail", () => {
    const filter = securityFilterFor(securePolicy);
    expect(filter("claude-code")).toEqual({ allowed: true });
    expect(filter("codex-cli")).toEqual({ allowed: true });
    expect(filter("mistral-vibe")).toEqual({ allowed: true });
  });
});
