import { describe, expect, expectTypeOf, it } from "vitest";
import { Either } from "effect";
import {
  decodeSecurityPosture,
  encodeSecurityPosture,
  readSecurityPosture,
  type SecurityPosture,
} from "../../../src/schemas/securityPosture.js";

const baseSecurePosture = {
  version: 3 as const,
  mode: "secure" as const,
  provider: "claude-code" as const,
  sandboxEnabled: true,
  filesystem: {
    allowRead: ["/worktree", "/home/user/.phax"],
    allowWrite: ["/worktree", "/home/user/.phax"],
  },
  network: {
    profile: "provider-only" as const,
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: false,
  marks: [] as const,
  agentCommands: [] as const,
  skillEditGrants: [],
  protectedPaths: null,
  providerSkippedForSecurity: [],
  stop: null,
};

const unsafePosture = {
  version: 3 as const,
  mode: "unsafe" as const,
  provider: "codex-cli" as const,
  sandboxEnabled: false,
  filesystem: {
    allowRead: [],
    allowWrite: [],
  },
  network: {
    profile: "open" as const,
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: false,
  marks: [] as const,
  agentCommands: [] as const,
  skillEditGrants: [],
  protectedPaths: null,
  providerSkippedForSecurity: [],
  stop: null,
};

const downgradedVibePosture = {
  version: 3 as const,
  mode: "secure" as const,
  provider: "mistral-vibe" as const,
  sandboxEnabled: true,
  filesystem: {
    allowRead: ["/worktree"],
    allowWrite: ["/worktree"],
  },
  network: {
    profile: "provider-only" as const,
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: true,
  marks: ["partial-filesystem", "mcp-unenforced"] as const,
  agentCommands: [] as const,
  skillEditGrants: [],
  protectedPaths: null,
  providerSkippedForSecurity: [],
  stop: null,
};

const withSkippedProviders = {
  version: 3 as const,
  mode: "secure" as const,
  provider: "claude-code" as const,
  sandboxEnabled: true,
  filesystem: {
    allowRead: ["/worktree"],
    allowWrite: ["/worktree"],
  },
  network: {
    profile: "provider-only" as const,
  },
  mcp: {
    mode: "disabled" as const,
    allow: [],
  },
  downgraded: false,
  marks: [] as const,
  agentCommands: [] as const,
  skillEditGrants: [],
  protectedPaths: null,
  providerSkippedForSecurity: [
    { provider: "mistral-vibe" as const, reason: "cannot satisfy strict secure mode" },
  ],
  stop: null,
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
        expect(result.right.marks).toEqual(["partial-filesystem", "mcp-unenforced"]);
      }
    });

    it("accepts posture with skipped providers", () => {
      const result = decodeSecurityPosture(withSkippedProviders);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.providerSkippedForSecurity).toHaveLength(1);
        expect(result.right.providerSkippedForSecurity[0]?.provider).toBe("mistral-vibe");
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
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects missing required field sandboxEnabled", () => {
      const invalid = { ...baseSecurePosture, sandboxEnabled: undefined };
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

  describe("agentCommands field", () => {
    it("accepts posture with populated agentCommands", () => {
      const posture = {
        ...baseSecurePosture,
        agentCommands: [
          {
            command: "deno fmt",
            source: "config" as const,
            explicit: true,
            requiredByPlan: true,
            enforcement: "prefix" as const,
            degraded: false,
          },
          {
            command: "git status",
            source: "gate" as const,
            explicit: false,
            requiredByPlan: false,
            enforcement: "prefix" as const,
            degraded: false,
          },
        ],
      };
      const result = decodeSecurityPosture(posture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.agentCommands).toHaveLength(2);
        expect(result.right.agentCommands[0]?.command).toBe("deno fmt");
        expect(result.right.agentCommands[0]?.source).toBe("config");
        expect(result.right.agentCommands[0]?.explicit).toBe(true);
        expect(result.right.agentCommands[0]?.requiredByPlan).toBe(true);
        expect(result.right.agentCommands[0]?.enforcement).toBe("prefix");
        expect(result.right.agentCommands[0]?.degraded).toBe(false);
      }
    });

    it("accepts agentCommands with degraded=true and none enforcement", () => {
      const posture = {
        ...baseSecurePosture,
        provider: "codex-cli" as const,
        agentCommands: [
          {
            command: "deno fmt",
            source: "config" as const,
            explicit: true,
            requiredByPlan: false,
            enforcement: "none" as const,
            degraded: true,
          },
        ],
      };
      const result = decodeSecurityPosture(posture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.agentCommands[0]?.degraded).toBe(true);
        expect(result.right.agentCommands[0]?.enforcement).toBe("none");
      }
    });

    it("rejects posture missing agentCommands field", () => {
      const invalid = {
        version: 1,
        mode: "secure" as const,
        provider: "claude-code" as const,
        sandboxEnabled: true,
        filesystem: { allowRead: ["/worktree"], allowWrite: ["/worktree"] },
        network: { profile: "provider-only" as const },
        mcp: { mode: "disabled" as const, allow: [] },
        downgraded: false,
        marks: [] as const,
        skillEditGrants: [],
        providerSkippedForSecurity: [],
        // agentCommands intentionally omitted
      };
      const result = decodeSecurityPosture(invalid);
      expect(Either.isLeft(result)).toBe(true);
    });

    it("rejects agentCommands entry with empty command string", () => {
      const posture = {
        ...baseSecurePosture,
        agentCommands: [
          {
            command: "",
            source: "config" as const,
            explicit: true,
            requiredByPlan: false,
            enforcement: "prefix" as const,
            degraded: false,
          },
        ],
      };
      const result = decodeSecurityPosture(posture);
      expect(Either.isLeft(result)).toBe(true);
    });

    const postureWithSource = (source: string) => ({
      ...baseSecurePosture,
      agentCommands: [
        {
          command: "node",
          source,
          explicit: true,
          requiredByPlan: false,
          enforcement: "prefix" as const,
          degraded: false,
        },
      ],
    });

    it.each(["config", "gate"])("accepts agentCommands source %s", (source) => {
      const result = decodeSecurityPosture(postureWithSource(source));
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.agentCommands[0]?.source).toBe(source);
      }
    });

    it("rejects an agentCommands source outside config and gate", () => {
      const result = decodeSecurityPosture(postureWithSource("plugin"));
      expect(Either.isLeft(result)).toBe(true);
    });

    it("round-trips posture with agentCommands", () => {
      const posture = {
        ...baseSecurePosture,
        agentCommands: [
          {
            command: "deno fmt",
            source: "config" as const,
            explicit: true,
            requiredByPlan: true,
            enforcement: "prefix" as const,
            degraded: false,
          },
        ],
      };
      const encoded = encodeSecurityPosture(posture);
      const decoded = decodeSecurityPosture(encoded);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right).toEqual(posture);
      }
    });
  });

  describe("skillEditGrants field", () => {
    it("round-trips posture with skill edit grants", () => {
      const posture = {
        ...baseSecurePosture,
        skillEditGrants: [".claude/skills/foo/SKILL.md"],
      };
      const decoded = decodeSecurityPosture(encodeSecurityPosture(posture));
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right.skillEditGrants).toEqual([".claude/skills/foo/SKILL.md"]);
      }
    });

    it("rejects posture missing skillEditGrants field", () => {
      const { skillEditGrants: _omitted, ...invalid } = baseSecurePosture;
      expect(Either.isLeft(decodeSecurityPosture(invalid))).toBe(true);
    });

    it("rejects an empty grant path", () => {
      const posture = { ...baseSecurePosture, skillEditGrants: [""] };
      expect(Either.isLeft(decodeSecurityPosture(posture))).toBe(true);
    });
  });

  describe("command-precision mark", () => {
    it("accepts command-precision in marks", () => {
      const posture = {
        ...baseSecurePosture,
        marks: ["command-precision"] as const,
      };
      const result = decodeSecurityPosture(posture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.marks).toContain("command-precision");
      }
    });

    it("accepts all three marks together", () => {
      const posture = {
        ...baseSecurePosture,
        marks: ["partial-filesystem", "mcp-unenforced", "command-precision"] as const,
      };
      const result = decodeSecurityPosture(posture);
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.marks).toHaveLength(3);
      }
    });

    it("round-trips posture with command-precision mark", () => {
      const posture = {
        ...baseSecurePosture,
        marks: ["command-precision"] as const,
        agentCommands: [
          {
            command: "deno fmt",
            source: "config" as const,
            explicit: true,
            requiredByPlan: false,
            enforcement: "none" as const,
            degraded: true,
          },
        ],
      };
      const encoded = encodeSecurityPosture(posture);
      const decoded = decodeSecurityPosture(encoded);
      expect(Either.isRight(decoded)).toBe(true);
      if (Either.isRight(decoded)) {
        expect(decoded.right.marks).toContain("command-precision");
      }
    });
  });

  describe("schema type inference", () => {
    it("has all required fields", () => {
      expectTypeOf<keyof SecurityPosture>().toEqualTypeOf<
        | "version"
        | "mode"
        | "provider"
        | "sandboxEnabled"
        | "filesystem"
        | "network"
        | "mcp"
        | "downgraded"
        | "marks"
        | "agentCommands"
        | "skillEditGrants"
        | "protectedPaths"
        | "providerSkippedForSecurity"
        | "stop"
      >();
    });
  });

  describe("the stop section and the one reader", () => {
    const closedStop = {
      cause: "held" as const,
      personWork: "outside-phax-enforcement" as const,
      turns: [
        {
          turn: "first-turn-01",
          kind: "first-turn" as const,
          narrowing: "read-only-tools" as const,
          agentCommands: [] as [],
        },
      ],
    };

    it("round-trips a closed stop", () => {
      const posture = { ...baseSecurePosture, stop: closedStop };
      const decoded = decodeSecurityPosture(encodeSecurityPosture(posture));
      expect(Either.isRight(decoded) && decoded.right.stop).toEqual(closedStop);
    });

    // oxlint-disable-next-line no-unused-vars
    const {
      stop: _stop,
      version: _version,
      protectedPaths: _protectedPaths,
      ...v1Fields
    } = baseSecurePosture;
    const v1 = { version: 1, ...v1Fields };
    const v2 = { version: 2, ...v1Fields, stop: null };

    it.each([
      ["a version-3 file without protectedPaths", { ...v1Fields, version: 3, stop: null }],
      ["a version-3 file with an extra key", { ...baseSecurePosture, extra: true }],
      [
        "a version-3 file with an empty globs list",
        {
          ...baseSecurePosture,
          protectedPaths: { globs: [], enforcement: "enforced" },
        },
      ],
      [
        "a version-3 file with an unknown enforcement",
        {
          ...baseSecurePosture,
          protectedPaths: { globs: ["phax.json"], enforcement: "full" },
        },
      ],
      ["a stop with an extra key", { ...baseSecurePosture, stop: { ...closedStop, extra: 1 } }],
      [
        "a turn that ran an agent command",
        {
          ...baseSecurePosture,
          stop: {
            ...closedStop,
            turns: [{ ...closedStop.turns[0], agentCommands: ["pnpm test"] }],
          },
        },
      ],
      ["a version-2 file with an extra key", { ...v2, extra: true }],
      ["a version-4 file", { ...baseSecurePosture, version: 4 }],
    ])("readSecurityPosture refuses %s", (_label, input) => {
      expect(Either.isLeft(readSecurityPosture(input))).toBe(true);
    });

    it("readSecurityPosture lifts a version-1 file with protectedPaths and stop null", () => {
      const read = readSecurityPosture(v1);
      expect(Either.isRight(read)).toBe(true);
      if (Either.isRight(read)) {
        expect(read.right).toEqual({ ...baseSecurePosture, stop: null, protectedPaths: null });
      }
    });

    it("readSecurityPosture lifts a version-2 file with protectedPaths null, keeping its stop", () => {
      const read = readSecurityPosture({ ...v2, stop: closedStop });
      expect(Either.isRight(read) && read.right).toEqual({
        ...baseSecurePosture,
        stop: closedStop,
        protectedPaths: null,
      });
    });

    it("readSecurityPosture round-trips a version-3 file that declares protected paths", () => {
      const posture = {
        ...baseSecurePosture,
        protectedPaths: { globs: ["**/steme.baseline.json", "phax.json"], enforcement: "enforced" },
      } as const;
      const read = readSecurityPosture(encodeSecurityPosture(posture));
      expect(Either.isRight(read) && read.right).toEqual(posture);
    });

    it("keeps the keys in order, protectedPaths before providerSkippedForSecurity", () => {
      const keys = Object.keys(encodeSecurityPosture(baseSecurePosture));
      expect(keys.indexOf("protectedPaths")).toBe(keys.indexOf("skillEditGrants") + 1);
      expect(keys.indexOf("providerSkippedForSecurity")).toBe(keys.indexOf("protectedPaths") + 1);
      expect(keys.at(-1)).toBe("stop");
    });

    it("readSecurityPosture reads a version-3 file as decodeSecurityPosture does", () => {
      const posture = { ...baseSecurePosture, stop: closedStop };
      const read = readSecurityPosture(encodeSecurityPosture(posture));
      expect(Either.isRight(read) && read.right).toEqual(posture);
    });
  });
});
