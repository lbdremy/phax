import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vitest";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  reject,
  strip,
  type Command,
  type Group,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";

class NoDebt extends Data.TaggedError("NoDebt")<{ readonly id: string }> {}

const NO_DEBT = 4;

/** A group `debt` of `accept` and `list`, each with its own input and codes. */
function debtGroup() {
  const acceptRun = vi.fn();
  const listRun = vi.fn();
  const accept = defineCommand({
    name: "accept",
    summary: "Accept a failing condition as debt",
    input: {
      args: reject(Schema.Tuple(Schema.String)),
      flags: reject(Schema.Struct({ why: Schema.String })),
    },
    output: strip(Schema.Struct({ id: Schema.String, why: Schema.String })),
    exits: { NoDebt: NO_DEBT },
    run: ({ input }) =>
      Effect.gen(function* () {
        acceptRun(input);
        const [id] = input.args;
        if (id === "9") return yield* new NoDebt({ id });
        return { id, why: input.flags.why };
      }),
    render: (value) => `accepted ${value.id}`,
  });
  const list = defineCommand({
    name: "list",
    summary: "List the debt",
    input: {},
    output: strip(Schema.Struct({ ids: Schema.Array(Schema.String) })),
    exits: {},
    run: () => {
      listRun();
      return Effect.succeed({ ids: ["1", "2"] });
    },
    render: (value) => value.ids.join("\n"),
  });
  const group = defineGroup({
    name: "debt",
    summary: "Accept debt, or list it",
    commands: [accept, list],
  });
  return { group, accept, list, acceptRun, listRun };
}

const programOf = (...entries: ReadonlyArray<Command<never> | Group<never>>) =>
  defineProgram({
    name: "steme",
    version: "1.0.0",
    exits: { refused: 3, defect: 70 },
    commands: entries,
  });

const lines = (text: ReadonlyArray<string>): ReadonlyArray<unknown> =>
  text
    .join("")
    .split("\n")
    .filter((each) => each !== "")
    .map((each): unknown => JSON.parse(each));

describe("a command group", () => {
  it("runs each command with its own input and answers its own codes", async () => {
    const debt = debtGroup();
    const program = programOf(debt.group);
    const accepted = await call(program, {
      argv: ["debt", "accept", "1", "--why", "late"],
    });
    expect(accepted.code).toBe(0);
    expect(accepted.out.join("")).toBe("accepted 1\n");
    expect(debt.acceptRun).toHaveBeenCalledWith({
      args: ["1"],
      flags: { why: "late" },
    });

    const missing = await call(program, {
      argv: ["debt", "accept", "9", "--why", "late"],
    });
    expect(missing.code).toBe(NO_DEBT);
    expect(missing.out).toEqual([]);

    const listed = await call(program, { argv: ["debt", "list"] });
    expect(listed.code).toBe(0);
    expect(listed.out.join("")).toBe("1\n2\n");
    expect(debt.listRun).toHaveBeenCalledTimes(1);
  });

  it("refuses a call a command of the group does not declare", async () => {
    const debt = debtGroup();
    const result = await call(programOf(debt.group), {
      argv: ["debt", "list", "--why", "late"],
    });
    expect(result.code).toBe(3);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("--why");
    expect(debt.listRun).not.toHaveBeenCalled();
  });

  it("refuses the group alone, with its help on stderr", async () => {
    const debt = debtGroup();
    const result = await call(programOf(debt.group), { argv: ["debt"] });
    expect(result.code).toBe(3);
    expect(result.out).toEqual([]);
    const text = result.err.join("");
    expect(text).toContain("accept");
    expect(text).toContain("Accept a failing condition as debt");
    expect(text).toContain("list");
    expect(debt.acceptRun).not.toHaveBeenCalled();
    expect(debt.listRun).not.toHaveBeenCalled();
  });

  it("has no help command, and answers --help with its commands", async () => {
    const debt = debtGroup();
    const program = programOf(debt.group);
    const asked = await call(program, { argv: ["debt", "help"] });
    expect(asked.code).toBe(3);
    expect(asked.out).toEqual([]);
    expect(asked.err.join("")).toContain("unknown command 'help'");

    const help = await call(program, { argv: ["debt", "--help"] });
    expect(help.code).toBe(0);
    expect(help.err).toEqual([]);
    expect(help.out.join("")).toContain("accept");
    expect(help.out.join("")).toContain("list");
  });

  it("is listed in the program's help with its summary, and its commands are not", async () => {
    const debt = debtGroup();
    const result = await call(programOf(debt.group), { argv: ["--help"] });
    expect(result.code).toBe(0);
    const text = result.out.join("");
    expect(text).toContain("debt");
    expect(text).toContain("Accept debt, or list it");
    expect(text).not.toContain("Accept a failing condition as debt");
  });

  it("refuses an unknown command of the group, naming the words it knows", async () => {
    const result = await call(programOf(debtGroup().group), {
      argv: ["debt", "forgive", "--json"],
    });
    expect(result.code).toBe(3);
    expect(lines(result.err)).toEqual([
      {
        kind: "refused",
        source: "command",
        path: ["forgive"],
        expected: "one of accept, list",
        text: "error: unknown command 'forgive'",
        exit: 3,
      },
    ]);
  });

  it("answers --json and --json-schema as a command alone does", async () => {
    const program = programOf(debtGroup().group);
    const json = await call(program, {
      argv: ["debt", "accept", "1", "--why", "late", "--json"],
    });
    expect(json.out.join("")).toBe(`${JSON.stringify({ id: "1", why: "late" }, null, 2)}\n`);
    const failed = await call(program, {
      argv: ["debt", "accept", "9", "--why", "late", "--json"],
    });
    expect(failed.code).toBe(NO_DEBT);
    expect(lines(failed.err)).toEqual([
      {
        kind: "error",
        error: "NoDebt",
        exit: NO_DEBT,
        fields: { id: "9" },
        written: [],
      },
    ]);

    const whole = await call(program, { argv: ["--json-schema"] });
    const catalogue = JSON.parse(whole.out.join("")) as {
      commands: Array<{ name: string[]; input: unknown }>;
    };
    expect(catalogue.commands.map((each) => each.name)).toEqual([
      ["debt", "accept"],
      ["debt", "list"],
    ]);
    const one = await call(program, {
      argv: ["debt", "accept", "--json-schema"],
    });
    expect(one.code).toBe(0);
    expect(JSON.parse(one.out.join(""))).toEqual(catalogue.commands[0]);
  });

  it("stops the program when a command of a group maps a tag to the defect code, naming it", async () => {
    const clash = defineCommand({
      name: "clash",
      summary: "maps a tag to the defect code",
      input: {},
      exits: { NoDebt: 70 },
      run: () => Effect.fail(new NoDebt({ id: "x" })),
    });
    const ok = debtGroup();
    const program = programOf(
      defineGroup({ name: "clashing", summary: "Clashing", commands: [clash] }),
      ok.group,
    );
    const result = await call(program, { argv: ["debt", "list"] });
    expect(result.code).toBe(70);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("clashing clash");
    expect(ok.listRun).not.toHaveBeenCalled();
  });

  it("stops the program when a command of a group declares an option the runner owns", async () => {
    const loud = defineCommand({
      name: "loud",
      summary: "declares --json",
      input: {
        flags: reject(Schema.Struct({ json: Schema.optionalKey(Schema.Boolean) })),
      },
      exits: {},
      run: () => Effect.void,
    });
    const ok = debtGroup();
    const program = programOf(
      defineGroup({ name: "loudly", summary: "Loud", commands: [loud] }),
      ok.group,
    );
    const result = await call(program, { argv: ["debt", "list"] });
    expect(result.code).toBe(70);
    expect(result.out).toEqual([]);
    expect(result.err.join("")).toContain("loudly loud");
    expect(result.err.join("")).toContain("--json");
    expect(ok.listRun).not.toHaveBeenCalled();
  });

  it("keeps the commands of a program without a group as they were given", () => {
    const debt = debtGroup();
    const plain = defineProgram({
      name: "steme",
      version: "1.0.0",
      exits: { refused: 3, defect: 70 },
      commands: [debt.list],
    });
    expect(plain.commands).toEqual([debt.list]);
    const grouped = programOf(debt.list, debt.group);
    expect(grouped.commands.map((each) => each.group?.name)).toEqual([undefined, "debt", "debt"]);
  });
});

// Gain carried for upstream (groups holding groups): a group holds groups beside its commands.
describe("a group nested in a group", () => {
  /** `plans` holds `lint` and the group `debt`, which holds its two commands. */
  function nested() {
    const debt = debtGroup();
    const lintRun = vi.fn();
    const lint = defineCommand({
      name: "lint",
      summary: "Lint the plans",
      input: {},
      output: strip(Schema.String),
      exits: {},
      run: () => {
        lintRun();
        return Effect.succeed("clean");
      },
      render: (text) => text,
    });
    const group = defineGroup({
      name: "plans",
      summary: "Work with plans",
      commands: [lint, debt.group],
    });
    return { group, debt, lintRun };
  }

  it("runs a command under its chain of groups, with its own input and codes", async () => {
    const tree = nested();
    const program = programOf(tree.group);
    const accepted = await call(program, {
      argv: ["plans", "debt", "accept", "1", "--why", "late"],
    });
    expect(accepted.code).toBe(0);
    expect(accepted.out.join("")).toBe("accepted 1\n");
    expect(tree.debt.acceptRun).toHaveBeenCalledWith({ args: ["1"], flags: { why: "late" } });
    const missing = await call(program, {
      argv: ["plans", "debt", "accept", "9", "--why", "late", "--json"],
    });
    expect(missing.code).toBe(NO_DEBT);
    expect(lines(missing.err)).toEqual([
      { kind: "error", error: "NoDebt", exit: NO_DEBT, fields: { id: "9" }, written: [] },
    ]);
    const linted = await call(program, { argv: ["plans", "lint"] });
    expect(linted.out.join("")).toBe("clean\n");
  });

  it("names each command by every word of its full name", async () => {
    const program = programOf(nested().group);
    const whole = await call(program, { argv: ["--json-schema"] });
    const catalogue = JSON.parse(whole.out.join("")) as { commands: Array<{ name: string[] }> };
    expect(catalogue.commands.map((each) => each.name)).toEqual([
      ["plans", "lint"],
      ["plans", "debt", "accept"],
      ["plans", "debt", "list"],
    ]);
    const one = await call(program, { argv: ["plans", "debt", "list", "--json-schema"] });
    expect(JSON.parse(one.out.join(""))).toEqual(catalogue.commands[2]);
    expect(program.commands.map((each) => each.group?.parent?.name)).toEqual([
      undefined,
      "plans",
      "plans",
    ]);
  });

  it("refuses the inner group alone, with its help on stderr", async () => {
    const tree = nested();
    const result = await call(programOf(tree.group), { argv: ["plans", "debt"] });
    expect(result.code).toBe(3);
    expect(result.out).toEqual([]);
    const text = result.err.join("");
    expect(text).toContain("accept");
    expect(text).toContain("Accept a failing condition as debt");
    expect(tree.debt.acceptRun).not.toHaveBeenCalled();
    expect(tree.lintRun).not.toHaveBeenCalled();
  });

  it("refuses the outer group alone, listing the inner group by its summary", async () => {
    const result = await call(programOf(nested().group), { argv: ["plans"] });
    expect(result.code).toBe(3);
    expect(result.out).toEqual([]);
    const text = result.err.join("");
    expect(text).toContain("lint");
    expect(text).toContain("debt");
    expect(text).toContain("Accept debt, or list it");
  });

  it("answers the inner group's --help on stdout", async () => {
    const help = await call(programOf(nested().group), { argv: ["plans", "debt", "--help"] });
    expect(help.code).toBe(0);
    expect(help.err).toEqual([]);
    expect(help.out.join("")).toContain("accept");
    expect(help.out.join("")).toContain("list");
  });

  it("refuses an unknown word inside the inner group, naming the words it knows", async () => {
    const result = await call(programOf(nested().group), {
      argv: ["plans", "debt", "forgive", "--json"],
    });
    expect(result.code).toBe(3);
    expect(lines(result.err)).toEqual([
      {
        kind: "refused",
        source: "command",
        path: ["forgive"],
        expected: "one of accept, list",
        text: "error: unknown command 'forgive'",
        exit: 3,
      },
    ]);
  });
});

/** Each part, found in `text` after the one before it. */
function inOrder(text: string, parts: ReadonlyArray<string>): boolean {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

// Gain carried for upstream (a group's long help and examples).
describe("a group with a long help and examples", () => {
  const documented = () => {
    const { group } = debtGroup();
    return defineGroup({
      name: group.name,
      summary: group.summary,
      help: "Debt is a failing condition accepted for now.",
      examples: ["steme debt accept 1 --why flaky", "steme debt list"],
      commands: group.commands,
    });
  };

  const ORDER = [
    "Accept debt, or list it",
    "Debt is a failing condition accepted for now.",
    "Examples:\n  steme debt accept 1 --why flaky\n  steme debt list",
    "Commands:",
    "Accept a failing condition as debt",
  ];

  it("says its summary, long help, examples, then its commands on --help", async () => {
    const help = await call(programOf(documented()), { argv: ["debt", "--help"] });
    expect(help.code).toBe(0);
    expect(help.err).toEqual([]);
    expect(inOrder(help.out.join(""), ORDER)).toBe(true);
  });

  it("writes the same help on stderr when called alone, and is refused", async () => {
    const alone = await call(programOf(documented()), { argv: ["debt"] });
    expect(alone.code).toBe(3);
    expect(alone.out).toEqual([]);
    expect(inOrder(alone.err.join(""), ORDER)).toBe(true);
  });

  it("is listed in the program's help by its summary alone", async () => {
    const help = await call(programOf(documented()), { argv: ["--help"] });
    expect(help.out.join("")).toContain("Accept debt, or list it");
    expect(help.out.join("")).not.toContain("Debt is a failing condition");
  });

  it("hands its long help and examples to each command's grouping", () => {
    const program = programOf(documented());
    expect(program.commands.map((command) => command.group?.examples)).toEqual([
      ["steme debt accept 1 --why flaky", "steme debt list"],
      ["steme debt accept 1 --why flaky", "steme debt list"],
    ]);
    expect(program.commands[0]?.group?.help).toBe("Debt is a failing condition accepted for now.");
  });
});
