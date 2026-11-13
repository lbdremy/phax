// phax's program as the runner holds it (src/cli/definitions/program.ts): its top-level commands
// and groups, and the arguments and options a few commands declare, read from their shapes.
import { describe, expect, it } from "vitest";
import {
  argShapes,
  flagShapes,
  fullName,
  type Command,
} from "../../src/cli/commandLibrary/contract/index.js";
import { ARCHIVE_RETIRED, artifactGroup } from "../../src/cli/definitions/artifact.js";
import { phaxProgram } from "../../src/cli/definitions/program.js";

const TOP_LEVEL_COMMANDS = [
  "validate",
  "unlock",
  "enter",
  "enter-phase",
  "session-info",
  "shell",
  "path",
  "open",
  "ls",
  "archive",
  "prune",
  "cost",
  "run",
  "review-handoff",
  "publish-pr",
  "review-compliance",
  "review-code",
  "plans",
  "adjust-plan",
  "brief",
  "architecture",
  "init",
  "resume",
  "reset-phase",
  "agent",
  "security",
  "skills",
  "schema",
  "artifact",
  "completions",
  "report",
  "records",
] as const;

/** The words that follow `words` in the program's commands, each once, in the order declared:
 *  the root's commands and groups for `[]`, a group's for its name. */
function under(words: ReadonlyArray<string>): ReadonlyArray<string> {
  const next: string[] = [];
  for (const command of phaxProgram.commands) {
    const name = fullName(command);
    if (name.length <= words.length || !words.every((word, index) => name[index] === word)) {
      continue;
    }
    const word = name[words.length] as string;
    if (!next.includes(word)) next.push(word);
  }
  return next;
}

function commandNamed(words: string): Command<unknown> {
  const command = phaxProgram.commands.find((each) => fullName(each).join(" ") === words);
  if (command === undefined) throw new Error(`phax ${words} is not a command`);
  return command;
}

const argsOf = (words: string): ReadonlyArray<string> => {
  const args = commandNamed(words).input.args;
  return args === undefined ? [] : argShapes(args.contract).map((arg) => arg.name);
};

const optionsOf = (words: string): ReadonlyArray<string> => {
  const flags = commandNamed(words).input.flags;
  return flags === undefined ? [] : flagShapes(flags.contract).map((flag) => `--${flag.option}`);
};

describe("phaxProgram", () => {
  it("is the phax program", () => {
    expect(phaxProgram.name).toBe("phax");
  });

  it("exposes the expected top-level commands", () => {
    const names = under([]);
    for (const name of TOP_LEVEL_COMMANDS) {
      expect(names, `expected top-level command '${name}'`).toContain(name);
    }
    expect(names.length).toBe(TOP_LEVEL_COMMANDS.length);
  });

  it("declares plans lint with a <plan> argument and no option of its own", () => {
    expect(argsOf("plans lint")).toEqual(["plan"]);
    expect(optionsOf("plans lint")).toEqual([]);
  });

  it("declares ls's filters and --complete", () => {
    expect(optionsOf("ls")).toEqual([
      "--active",
      "--failed",
      "--review-open",
      "--awaiting-review",
      "--archived",
      "--complete",
    ]);
  });

  it("exposes agent subcommands: models, resolve, probe, setup", () => {
    const agentSubs = under(["agent"]);
    expect(agentSubs).toContain("models");
    expect(agentSubs).toContain("resolve");
    expect(agentSubs).toContain("probe");
    expect(agentSubs).toContain("setup");
  });

  it("exposes agent setup subcommands: mistral-vibe, providers", () => {
    const setupSubs = under(["agent", "setup"]);
    expect(setupSubs).toContain("mistral-vibe");
    expect(setupSubs).toContain("providers");
  });

  it("exposes security subcommand: status", () => {
    expect(under(["security"])).toContain("status");
  });

  it("exposes skills subcommand: install", () => {
    expect(under(["skills"])).toContain("install");
  });

  it("exposes schema subcommand: upgrade", () => {
    expect(under(["schema"])).toContain("upgrade");
  });

  it("review-code has <short-name> arg and --new-session, --model, --effort flags", () => {
    expect(argsOf("review-code")).toContain("short-name");
    const optionNames = optionsOf("review-code");
    expect(optionNames).toContain("--new-session");
    expect(optionNames).toContain("--model");
    expect(optionNames).toContain("--effort");
  });

  it("adjust-plan has <plan> arg and --landed, --new-session, --model, --effort flags", () => {
    expect(argsOf("adjust-plan")).toContain("plan");
    const optionNames = optionsOf("adjust-plan");
    expect(optionNames).toContain("--landed");
    expect(optionNames).toContain("--new-session");
    expect(optionNames).toContain("--model");
    expect(optionNames).toContain("--effort");
  });

  it("plans overlap has variadic <plan...> arg and --json, --no-extract, --landed flags", () => {
    expect(argsOf("plans overlap")).toContain("plan");
    const optionNames = optionsOf("plans overlap");
    expect(optionNames).toContain("--no-extract");
    expect(optionNames).toContain("--landed");
  });

  it("exposes plans subcommands: status, overlap", () => {
    const subs = under(["plans"]);
    expect(subs).toContain("status");
    expect(subs).toContain("overlap");
  });

  it("artifact's subcommands are exactly status, approve, stale, abandon, complete, reopen, decide, new, schema, migrate-approvals, migrate-documents; archive is a retired word of the group", () => {
    expect(under(["artifact"])).toEqual([
      "status",
      "approve",
      "stale",
      "abandon",
      "complete",
      "reopen",
      "decide",
      "revise",
      "new",
      "schema",
      "migrate-approvals",
      "migrate-documents",
    ]);
    // `archive` is no command, but a retired word of the group, refused with the sentence naming
    // `complete`.
    expect(artifactGroup.retired?.["archive"]).toBe(ARCHIVE_RETIRED);
    expect(under(["artifact", "new"])).toEqual(["spec", "plan"]);
  });

  it("plans status has the --apply flag", () => {
    expect(optionsOf("plans status")).toContain("--apply");
  });
});
