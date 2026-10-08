import { describe, expect, it } from "vitest";
import {
  checkRequiredCommands,
  computeFrozenAgentCommands,
} from "../../../src/domain/security/agentCommands.js";

describe("computeFrozenAgentCommands — enforcement and degradation", () => {
  it("broad allowance (deno) is never degraded under any provider", () => {
    for (const provider of ["claude-code", "codex-cli", "mistral-vibe"] as const) {
      const { records, degraded } = computeFrozenAgentCommands({
        configCommands: ["deno"],
        gateCommands: [],
        briefCommands: [],
        requiredCommands: [],
        provider,
      });
      expect(records[0]?.degraded, `${provider} broad`).toBe(false);
      expect(degraded, `${provider} top-level degraded`).toBe(false);
    }
  });

  it("narrow allowance (deno fmt) is degraded under codex-cli (none)", () => {
    const { records, degraded } = computeFrozenAgentCommands({
      configCommands: ["deno fmt"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: [],
      provider: "codex-cli",
    });
    expect(records[0]?.degraded).toBe(true);
    expect(degraded).toBe(true);
  });

  it("narrow allowance (deno fmt) is degraded under mistral-vibe (none)", () => {
    const { records, degraded } = computeFrozenAgentCommands({
      configCommands: ["deno fmt"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: [],
      provider: "mistral-vibe",
    });
    expect(records[0]?.degraded).toBe(true);
    expect(degraded).toBe(true);
  });

  it("narrow allowance (deno fmt) is NOT degraded under claude-code (prefix)", () => {
    const { records, degraded } = computeFrozenAgentCommands({
      configCommands: ["deno fmt"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records[0]?.degraded).toBe(false);
    expect(degraded).toBe(false);
  });
});

describe("computeFrozenAgentCommands — source and explicit", () => {
  it("config+gate overlap collapses to one record with source:config, explicit:true", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno fmt"],
      gateCommands: ["deno fmt"],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.source).toBe("config");
    expect(records[0]?.explicit).toBe(true);
  });

  it("gate-only command has source:gate, explicit:false", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: [],
      gateCommands: ["git commit"],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records[0]?.source).toBe("gate");
    expect(records[0]?.explicit).toBe(false);
  });

  it("config-only command has source:config, explicit:true", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records[0]?.source).toBe("config");
    expect(records[0]?.explicit).toBe(true);
  });
});

describe("computeFrozenAgentCommands — requiredByPlan", () => {
  it("requiredByPlan is true only for commands in requiredCommands", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno fmt", "git commit"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: ["deno fmt"],
      provider: "claude-code",
    });
    const denoFmt = records.find((r) => r.command === "deno fmt");
    const gitCommit = records.find((r) => r.command === "git commit");
    expect(denoFmt?.requiredByPlan).toBe(true);
    expect(gitCommit?.requiredByPlan).toBe(false);
  });

  it("requiredByPlan normalises whitespace before matching", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno  fmt"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: ["deno fmt"],
      provider: "claude-code",
    });
    expect(records[0]?.command).toBe("deno fmt");
    expect(records[0]?.requiredByPlan).toBe(true);
  });
});

describe("computeFrozenAgentCommands — normalisation and deduplication", () => {
  it("empty strings are dropped", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["", "  "],
      gateCommands: [""],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records).toHaveLength(0);
  });

  it("order-stable: config commands appear before gate-only commands", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno"],
      gateCommands: ["git commit", "deno"],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records).toHaveLength(2);
    expect(records[0]?.command).toBe("deno");
    expect(records[1]?.command).toBe("git commit");
  });

  it("enforcement matches the provider", () => {
    const { records: claude } = computeFrozenAgentCommands({
      configCommands: ["deno"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(claude[0]?.enforcement).toBe("prefix");

    const { records: codex } = computeFrozenAgentCommands({
      configCommands: ["deno"],
      gateCommands: [],
      briefCommands: [],
      requiredCommands: [],
      provider: "codex-cli",
    });
    expect(codex[0]?.enforcement).toBe("none");
  });
});

describe("computeFrozenAgentCommands — brief grant", () => {
  it("a brief command is appended after config and gate entries with source brief", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno"],
      gateCommands: ["git commit"],
      briefCommands: ["phax brief"],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records.map((r) => r.command)).toEqual(["deno", "git commit", "phax brief"]);
    expect(records[2]).toMatchObject({ source: "brief", explicit: false, degraded: false });
  });

  it("a config entry `phax brief` keeps source config and appears once", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["phax  brief"],
      gateCommands: [],
      briefCommands: ["phax brief"],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ command: "phax brief", source: "config", explicit: true });
  });

  it("a gate entry `phax brief` keeps source gate", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: [],
      gateCommands: ["phax brief"],
      briefCommands: ["phax brief"],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records).toHaveLength(1);
    expect(records[0]?.source).toBe("gate");
  });

  it("an empty brief list leaves the records unchanged", () => {
    const { records } = computeFrozenAgentCommands({
      configCommands: ["deno fmt"],
      gateCommands: ["git commit"],
      briefCommands: [],
      requiredCommands: [],
      provider: "claude-code",
    });
    expect(records.map((r) => [r.command, r.source])).toEqual([
      ["deno fmt", "config"],
      ["git commit", "gate"],
    ]);
  });

  it("`phax brief` is degraded on a provider without prefix enforcement", () => {
    for (const provider of ["codex-cli", "mistral-vibe"] as const) {
      const { records, degraded } = computeFrozenAgentCommands({
        configCommands: [],
        gateCommands: [],
        briefCommands: ["phax brief"],
        requiredCommands: [],
        provider,
      });
      expect(records[0]?.degraded, provider).toBe(true);
      expect(degraded, provider).toBe(true);
    }
  });
});

describe("checkRequiredCommands", () => {
  it("exact match: required command present in config is not missing", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["deno fmt"],
      configCommands: ["deno fmt"],
      gateCommands: [],
    });
    expect(missing).toEqual([]);
  });

  it("exact match: required command present in gate is not missing", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["git commit"],
      configCommands: [],
      gateCommands: ["git commit"],
    });
    expect(missing).toEqual([]);
  });

  it("broad-covers-narrow: broad allowed 'deno' covers required 'deno fmt'", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["deno fmt"],
      configCommands: ["deno"],
      gateCommands: [],
    });
    expect(missing).toEqual([]);
  });

  it("broad-covers-narrow: broad allowed 'deno' covers required 'deno task build'", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["deno task build"],
      configCommands: ["deno"],
      gateCommands: [],
    });
    expect(missing).toEqual([]);
  });

  it("narrow allowed 'deno fmt' does NOT cover required 'deno task build'", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["deno task build"],
      configCommands: ["deno fmt"],
      gateCommands: [],
    });
    expect(missing).toEqual(["deno task build"]);
  });

  it("genuinely missing required command is reported in missing", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["cargo build"],
      configCommands: ["deno"],
      gateCommands: ["git commit"],
    });
    expect(missing).toEqual(["cargo build"]);
  });

  it("whitespace variants are normalised before comparison", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["  deno   fmt  "],
      configCommands: ["deno fmt"],
      gateCommands: [],
    });
    expect(missing).toEqual([]);
  });

  it("empty requiredCommands produces no missing", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: [],
      configCommands: [],
      gateCommands: [],
    });
    expect(missing).toEqual([]);
  });

  it("multiple missing commands are all reported", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["deno fmt", "cargo test"],
      configCommands: [],
      gateCommands: [],
    });
    expect(missing).toEqual(["deno fmt", "cargo test"]);
  });

  it("narrow allowed does NOT cover a different narrow command", () => {
    const { missing } = checkRequiredCommands({
      requiredCommands: ["deno lint"],
      configCommands: ["deno fmt"],
      gateCommands: [],
    });
    expect(missing).toEqual(["deno lint"]);
  });
});
