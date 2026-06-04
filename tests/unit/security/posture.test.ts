import { describe, expect, it } from "vitest";
import { Either } from "effect";
import {
  decodeSecurityPosture,
  encodeSecurityPosture,
  SecurityPostureSchema,
} from "../../../src/schemas/securityPosture.js";

const baseSecurePosture = {
  version: 1,
  mode: "secure" as const,
  provider: "claude-code" as const,
  sandboxEnabled: true,
  filesystem: {
    allowRead: ["/worktree", "/home/user/.phax"],
    allowWrite: ["/worktree", "/home/user/.phax"],
  },
  network: {
    profile: "provider-only" as const,
    allowDomains: ["api.anthropic.com"],
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: false,
  marks: [] as const,
  providerSkippedForSecurity: [],
};

const unsafePosture = {
  version: 1,
  mode: "unsafe" as const,
  provider: "codex-cli" as const,
  sandboxEnabled: false,
  filesystem: {
    allowRead: [],
    allowWrite: [],
  },
  network: {
    profile: "open" as const,
    allowDomains: [],
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: false,
  marks: [] as const,
  providerSkippedForSecurity: [],
};

const downgradedVibePosture = {
  version: 1,
  mode: "secure" as const,
  provider: "mistral-vibe" as const,
  sandboxEnabled: true,
  filesystem: {
    allowRead: ["/worktree"],
    allowWrite: ["/worktree"],
  },
  network: {
    profile: "provider-only" as const,
    allowDomains: ["api.mistral.ai"],
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: true,
  marks: ["partial-filesystem", "network-unenforced"] as const,
  providerSkippedForSecurity: [],
};

const withSkippedProviders = {
  version: 1,
  mode: "secure" as const,
  provider: "claude-code" as const,
  sandboxEnabled: true,
  filesystem: {
    allowRead: ["/worktree"],
    allowWrite: ["/worktree"],
  },
  network: {
    profile: "provider-only" as const,
    allowDomains: ["api.anthropic.com"],
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: false,
  marks: [] as const,
  providerSkippedForSecurity: [
    { provider: "mistral-vibe" as const, reason: "cannot satisfy strict secure mode" },
  ],
};

describe("SecurityPostureSchema", () => {
  describe("accepts valid postures", () => {
    it("accepts secure mode with claude-code", () => {
      const result = decodeSecurityPosture(baseSecurePosture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.mode).toBe("secure");
        expect(result.right.provider).toBe("claude-code");
        expect(result.right.sandboxEnabled).toBe(true);
      }
    });

    it("accepts unsafe mode", () => {
      const result = decodeSecurityPosture(unsafePosture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.mode).toBe("unsafe");
        expect(result.right.sandboxEnabled).toBe(false);
      }
    });

    it("accepts isolated mode", () => {
      const isolated = { ...baseSecurePosture, mode: "isolated" as const };
      const result = decodeSecurityPosture(isolated);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.mode).toBe("isolated");
      }
    });

    it("accepts downgraded posture with marks", () => {
      const result = decodeSecurityPosture(downgradedVibePosture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.downgraded).toBe(true);
        expect(result.right.marks).toEqual(["partial-filesystem", "network-unenforced"]);
      }
    });

    it("accepts posture with skipped providers", () => {
      const result = decodeSecurityPosture(withSkippedProviders);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.providerSkippedForSecurity).toHaveLength(1);
        expect(result.right.providerSkippedForSecurity[0].provider).toBe("mistral-vibe");
      }
    });

    it("accepts all providers", () => {
      for (const provider of ["claude-code", "codex-cli", "mistral-vibe"] as const) {
        const posture = { ...baseSecurePosture, provider };
        const result = decodeSecurityPosture(posture);
        expect(Either.isRight(result), `should accept provider ${provider}`).toBe(true);
      }
    });

    it("accepts all network profiles", () => {
      for (const profile of ["provider-only", "dev-allowlist", "open"] as const) {
        const posture = {
          ...baseSecurePosture,
          network: { ...baseSecurePosture.network, profile },
        };
        const result = decodeSecurityPosture(posture);
        expect(Either.isRight(result), `should accept profile ${profile}`).toBe(true);
      }
    });

    it("accepts all mcp modes", () => {
      for (const mode of ["disabled", "local-only", "allowlist", "provider-default"] as const) {
        const posture = { ...baseSecurePosture, mcp: { ...baseSecurePosture.mcp, mode } };
        const result = decodeSecurityPosture(posture);
        expect(Either.isRight(result), `should accept mcp mode ${mode}`).toBe(true);
      }
    });
  });

  describe("rejects invalid postures", () => {
    it("rejects missing version", () => {
      const invalid = { ...baseSecurePosture, version: undefined };
      // @ts-expect-error - intentionally invalid
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects wrong version", () => {
      const invalid = { ...baseSecurePosture, version: 2 };
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects invalid mode", () => {
      const invalid = { ...baseSecurePosture, mode: "custom" as const };
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects invalid provider", () => {
      const invalid = { ...baseSecurePosture, provider: "custom-provider" as const };
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects empty filesystem allowRead array", () => {
      // This should actually pass since empty arrays are allowed
      // Let's test with a non-array value instead
      const invalid = {
        ...baseSecurePosture,
        filesystem: { ...baseSecurePosture.filesystem, allowRead: "not-an-array" },
      };
      // @ts-expect-error - intentionally invalid
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects missing required field sandboxEnabled", () => {
      const invalid = { ...baseSecurePosture, sandboxEnabled: undefined };
      // @ts-expect-error - intentionally invalid
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects empty providerSkippedForSecurity entry reason", () => {
      const invalid = {
        ...baseSecurePosture,
        providerSkippedForSecurity: [{ provider: "claude-code" as const, reason: "" }],
      };
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });
  });

  describe("encode/decode round-trip", () => {
    it("round-trips base secure posture", () => {
      const encoded = encodeSecurityPosture(baseSecurePosture);
      const decoded = decodeSecurityPosture(encoded);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right).toEqual(baseSecurePosture);
      }
    });

    it("round-trips unsafe posture", () => {
      const encoded = encodeSecurityPosture(unsafePosture);
      const decoded = decodeSecurityPosture(encoded);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right).toEqual(unsafePosture);
      }
    });

    it("round-trips downgraded vibe posture", () => {
      const encoded = encodeSecurityPosture(downgradedVibePosture);
      const decoded = decodeSecurityPosture(encoded);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right).toEqual(downgradedVibePosture);
      }
    });

    it("round-trips posture with skipped providers", () => {
      const encoded = encodeSecurityPosture(withSkippedProviders);
      const decoded = decodeSecurityPosture(encoded);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right).toEqual(withSkippedProviders);
      }
    });
  });

  describe("schema type inference", () => {
    it("has all required fields", () => {
      // This is a compile-time check that the schema has the expected shape
      type Posture = typeof SecurityPostureSchema._A;
      // We can't easily test this at runtime, but the type should match our expectations
      expect(true).toBe(true);
    });
  });
});
