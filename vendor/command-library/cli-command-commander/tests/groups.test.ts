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
} from "@steme-lab/cli-command";
import { call } from "./support/memory-io.ts";

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
      args: reject(Schema.Tuple([Schema.String])),
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
    expect(json.out.join("")).toBe(
      `${JSON.stringify({ id: "1", why: "late" }, null, 2)}\n`,
    );
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
        flags: reject(
          Schema.Struct({ json: Schema.optionalKey(Schema.Boolean) }),
        ),
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
    expect(grouped.commands.map((each) => each.group?.name)).toEqual([
      undefined,
      "debt",
      "debt",
    ]);
  });
});
