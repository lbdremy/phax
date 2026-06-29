import { describe, expect, it } from "vitest";
import { buildProgram } from "../../src/cli/program.js";

const TOP_LEVEL_COMMANDS = [
  "validate",
  "unlock",
  "extract-plan",
  "enter",
  "enter-phase",
  "session-info",
  "shell",
  "path",
  "open",
  "ls",
  "archive",
  "run",
  "review-handoff",
  "publish-pr",
  "review-compliance",
  "review-code",
  "plans-overlap",
  "init",
  "resume",
  "reset-phase",
  "agent",
  "security",
  "skills",
  "schema",
  "completions",
  "report",
] as const;

describe("buildProgram", () => {
  it("returns a Command without executing side effects", () => {
    const program = buildProgram();
    expect(program.name()).toBe("phax");
  });

  it("exposes the expected top-level commands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    for (const name of TOP_LEVEL_COMMANDS) {
      expect(names, `expected top-level command '${name}'`).toContain(name);
    }
    expect(names.length).toBe(TOP_LEVEL_COMMANDS.length);
  });

  it("exposes agent subcommands: models, resolve, probe, setup", () => {
    const program = buildProgram();
    const agentCmd = program.commands.find((c) => c.name() === "agent");
    expect(agentCmd).toBeDefined();
    const agentSubs = agentCmd!.commands.map((c) => c.name());
    expect(agentSubs).toContain("models");
    expect(agentSubs).toContain("resolve");
    expect(agentSubs).toContain("probe");
    expect(agentSubs).toContain("setup");
  });

  it("exposes agent setup subcommands: mistral-vibe, providers", () => {
    const program = buildProgram();
    const agentCmd = program.commands.find((c) => c.name() === "agent");
    const setupCmd = agentCmd!.commands.find((c) => c.name() === "setup");
    expect(setupCmd).toBeDefined();
    const setupSubs = setupCmd!.commands.map((c) => c.name());
    expect(setupSubs).toContain("mistral-vibe");
    expect(setupSubs).toContain("providers");
  });

  it("exposes security subcommand: status", () => {
    const program = buildProgram();
    const securityCmd = program.commands.find((c) => c.name() === "security");
    expect(securityCmd).toBeDefined();
    const subs = securityCmd!.commands.map((c) => c.name());
    expect(subs).toContain("status");
  });

  it("exposes skills subcommand: install", () => {
    const program = buildProgram();
    const skillsCmd = program.commands.find((c) => c.name() === "skills");
    expect(skillsCmd).toBeDefined();
    const subs = skillsCmd!.commands.map((c) => c.name());
    expect(subs).toContain("install");
  });

  it("exposes schema subcommand: upgrade", () => {
    const program = buildProgram();
    const schemaCmd = program.commands.find((c) => c.name() === "schema");
    expect(schemaCmd).toBeDefined();
    const subs = schemaCmd!.commands.map((c) => c.name());
    expect(subs).toContain("upgrade");
  });

  it("review-code has <short-name> arg and --new-session, --model, --effort flags", () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === "review-code");
    expect(cmd).toBeDefined();

    const argNames = cmd!.registeredArguments.map((a) => a.name());
    expect(argNames).toContain("short-name");

    const optionNames = cmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--new-session");
    expect(optionNames).toContain("--model");
    expect(optionNames).toContain("--effort");
  });

  it("plans-overlap has variadic <plan...> arg and --json, --no-extract flags", () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === "plans-overlap");
    expect(cmd).toBeDefined();

    const argNames = cmd!.registeredArguments.map((a) => a.name());
    expect(argNames).toContain("plan");

    const optionNames = cmd!.options.map((o) => o.long);
    expect(optionNames).toContain("--json");
    expect(optionNames).toContain("--no-extract");
  });
});
