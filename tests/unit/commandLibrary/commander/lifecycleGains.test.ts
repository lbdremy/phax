// The gains the lifecycle and authoring commands need (command-contracts plan 3, phase-01),
// through `runner.run` over the memory Io, beyond their conformance cases: a short alias, a
// `say` line on stdout, the document as read, a document's check, and a group's retired words.
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  AliasAnnotationId,
  defineCommand,
  defineGroup,
  defineProgram,
  OPTION_HELP,
  Refused,
  reject,
  stdinFlagHelp,
  strip,
  usageSpec,
  type Command,
  type Group,
  type StdinDocument,
} from "../../../../src/cli/commandLibrary/contract/index.js";
import { call } from "./support/memoryIo.js";

const programOf = (...entries: ReadonlyArray<Command<never> | Group<never>>) =>
  defineProgram({
    name: "phax",
    version: "1.0.0",
    exits: { refused: 64, defect: 70 },
    refusalHint: "Run `phax --help` for usage.",
    commands: entries,
  });

const lines = (written: ReadonlyArray<string>): ReadonlyArray<unknown> =>
  written
    .join("")
    .split("\n")
    .filter((each) => each !== "")
    .map((each): unknown => JSON.parse(each));

const Yes = Schema.optionalWith(Schema.Boolean, { exact: true }).annotations({
  description: "Proceed without confirmation",
  [AliasAnnotationId]: "y",
});

function prune() {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "prune",
    summary: "Prune what is done",
    input: { flags: reject(Schema.Struct({ yes: Yes })) },
    output: strip(Schema.String),
    exits: {},
    run: ({ input }) =>
      Effect.sync(() => {
        seen.push(input);
        return "pruned";
      }),
    render: (text) => text,
  });
  return { command, seen };
}

describe("a short alias", () => {
  it("decodes -y and --yes alike", async () => {
    const short = prune();
    const long = prune();
    expect((await call(programOf(short.command), { argv: ["prune", "-y"] })).code).toBe(0);
    expect((await call(programOf(long.command), { argv: ["prune", "--yes"] })).code).toBe(0);
    expect(short.seen).toEqual(long.seen);
    expect(short.seen).toEqual([{ flags: { yes: true } }]);
  });

  it("refuses an unknown -z with 64, running nothing", async () => {
    const pruned = prune();
    const called = await call(programOf(pruned.command), { argv: ["prune", "-z"] });
    expect(called.code).toBe(64);
    expect(called.err.join("")).toContain("unknown option '-z'");
    expect(pruned.seen).toEqual([]);
  });

  it('shows -y, --yes in help and writes flag "--yes -y" in the usage spec', async () => {
    const help = await call(programOf(prune().command), { argv: ["prune", "--help"] });
    expect(help.out.join("")).toMatch(/-y, --yes\s+Proceed without confirmation/);
    expect(usageSpec(programOf(prune().command))).toContain(
      'flag "--yes -y" help="Proceed without confirmation"',
    );
  });
});

const read = (contract: Schema.Schema.Any) =>
  defineCommand({
    name: "decide",
    summary: "Decide",
    input: { stdin: reject(contract, { flag: "verdicts", valueRequired: true }) },
    output: strip(Schema.String),
    exits: {},
    run: () => Effect.succeed("decided"),
    render: (text) => text,
  });

describe("a stdin flag's help", () => {
  it("is the contract's description in help and the usage spec", async () => {
    const command = read(
      Schema.Struct({ verdicts: Schema.Array(Schema.String) }).annotations({
        description: "Decide from a verdicts file, or - for stdin",
      }),
    );
    const help = await call(programOf(command), { argv: ["decide", "--help"] });
    expect(help.out.join("")).toMatch(
      /--verdicts <file\|->\s+Decide from a verdicts file, or - for stdin/,
    );
    expect(usageSpec(programOf(command))).toContain(
      'help="Decide from a verdicts file, or - for stdin"',
    );
  });

  it("is the library's sentence when the contract carries no description", () => {
    const command = read(Schema.Struct({ verdicts: Schema.Array(Schema.String) }));
    expect(stdinFlagHelp(Schema.Struct({}))).toBeUndefined();
    expect(usageSpec(programOf(command))).toContain(`help="${OPTION_HELP.stdinValue("verdicts")}"`);
  });
});

function author() {
  return defineCommand({
    name: "author",
    summary: "Author a spec",
    input: {},
    output: strip(Schema.Struct({ path: Schema.String })),
    exits: {},
    run: ({ say, progress }) =>
      Effect.gen(function* () {
        yield* say("authoring spec garden — opus / high");
        yield* progress("retrying once");
        return { path: "docs/specs/garden.md" };
      }),
    render: (answer) => `wrote ${answer.path}`,
  });
}

describe("say", () => {
  it("writes its lines on stdout before the render", async () => {
    const called = await call(programOf(author()), { argv: ["author"] });
    expect(called.code).toBe(0);
    expect(called.out).toEqual([
      "authoring spec garden — opus / high\n",
      "wrote docs/specs/garden.md\n",
    ]);
    expect(called.err).toEqual(["retrying once\n"]);
  });

  it("becomes a note line under --json, stdout holding the answer alone", async () => {
    const called = await call(programOf(author()), { argv: ["author", "--json"] });
    expect(called.code).toBe(0);
    expect(called.out).toEqual([`${JSON.stringify({ path: "docs/specs/garden.md" }, null, 2)}\n`]);
    expect(lines(called.err)).toEqual([
      { kind: "note", text: "authoring spec garden — opus / high" },
      { kind: "note", text: "retrying once" },
    ]);
  });
});

const Verdicts = Schema.Struct({ verdicts: Schema.Array(Schema.String) });

function decide() {
  const documents: Array<StdinDocument | undefined> = [];
  const runs: unknown[] = [];
  const command = defineCommand({
    name: "decide",
    summary: "Decide an artifact",
    input: { stdin: reject(Verdicts, { flag: "verdicts", valueRequired: true }) },
    output: strip(Schema.String),
    exits: {},
    check: ({ input, document }) =>
      Effect.suspend(() => {
        documents.push(document);
        const at = (input.stdin?.verdicts ?? []).indexOf("q-unknown");
        return at === -1
          ? Effect.void
          : Effect.fail(
              new Refused({
                source: "stdin",
                path: ["verdicts", String(at), "chosen"],
                expected: "an option id of q-cadence",
                text: `error: verdicts.json: verdicts[${at}].chosen is not an option of q-cadence`,
              }),
            );
      }),
    run: ({ input, document }) =>
      Effect.sync(() => {
        runs.push({ input, document });
        return "decided";
      }),
    render: (text) => text,
  });
  return { command, documents, runs };
}

describe("the document as read", () => {
  it("carries the path as the call wrote it, and the text before decoding", async () => {
    const text = `{"verdicts": ["q-cadence"]}\n`;
    const decided = decide();
    const called = await call(programOf(decided.command), {
      argv: ["decide", "--verdicts", "../verdicts.json"],
      files: { "../verdicts.json": text },
    });
    expect(called.code).toBe(0);
    expect(decided.runs).toEqual([
      {
        input: { stdin: { verdicts: ["q-cadence"] } },
        document: { origin: { kind: "file", path: "../verdicts.json" }, text },
      },
    ]);
  });

  it("carries stdin when the flag's value is -", async () => {
    const text = `{"verdicts": []}`;
    const decided = decide();
    await call(programOf(decided.command), { argv: ["decide", "--verdicts=-"], stdin: text });
    expect(decided.documents).toEqual([{ origin: { kind: "stdin" }, text }]);
  });

  it("is absent when the flag is", async () => {
    const decided = decide();
    await call(programOf(decided.command), { argv: ["decide"] });
    expect(decided.runs).toEqual([{ input: { stdin: undefined }, document: undefined }]);
  });
});

describe("a document's check", () => {
  it("names its field in one refused line under --json, exits 64 and runs nothing", async () => {
    const decided = decide();
    const called = await call(programOf(decided.command), {
      argv: ["decide", "--verdicts", "verdicts.json", "--json"],
      files: { "verdicts.json": JSON.stringify({ verdicts: ["q-unknown"] }) },
    });
    expect(called.code).toBe(64);
    expect(called.out).toEqual([]);
    expect(lines(called.err)).toEqual([
      {
        kind: "refused",
        source: "stdin",
        path: ["verdicts", "0", "chosen"],
        expected: "an option id of q-cadence",
        text: "error: verdicts.json: verdicts[0].chosen is not an option of q-cadence",
        exit: 64,
      },
    ]);
    expect(decided.runs).toEqual([]);
  });

  it("writes its text then the refusal hint without --json", async () => {
    const decided = decide();
    const called = await call(programOf(decided.command), {
      argv: ["decide", "--verdicts", "-"],
      stdin: JSON.stringify({ verdicts: ["q-unknown"] }),
    });
    expect(called.code).toBe(64);
    expect(called.err.join("")).toBe(
      "error: verdicts.json: verdicts[0].chosen is not an option of q-cadence\nRun `phax --help` for usage.\n",
    );
    expect(decided.runs).toEqual([]);
  });

  it("runs after the prompts refusal: a prompting --json call is refused before its check", async () => {
    const checks: unknown[] = [];
    const prompting = defineCommand({
      name: "approve",
      summary: "Approve, asking a person",
      input: {},
      output: strip(Schema.String),
      exits: {},
      prompts: () => true,
      check: () => Effect.sync(() => void checks.push("checked")),
      run: () => Effect.succeed("approved"),
    });
    const called = await call(programOf(prompting), { argv: ["approve", "--json"] });
    expect(called.code).toBe(64);
    expect(checks).toEqual([]);
  });

  it("is a defect when it fails with anything but Refused", async () => {
    const failing = defineCommand({
      name: "broken",
      summary: "A check that fails untagged",
      input: {},
      output: strip(Schema.String),
      exits: {},
      check: () => Effect.die(new Error("no world to check against")),
      run: () => Effect.succeed("ran"),
    });
    const called = await call(programOf(failing), { argv: ["broken"] });
    expect(called.code).toBe(70);
    expect(called.out).toEqual([]);
  });
});

describe("a group's retired words", () => {
  const SENTENCE = `unknown transition "archive" — the completion transition is: phax artifact complete <path>`;

  function artifact() {
    const ran: string[] = [];
    const leaf = (name: string) =>
      defineCommand({
        name,
        summary: `The ${name} command`,
        input: {},
        output: strip(Schema.String),
        exits: {},
        run: () => Effect.sync(() => (ran.push(name), name)),
      });
    const group = defineGroup({
      name: "artifact",
      summary: "Artifacts",
      commands: [
        leaf("status"),
        defineGroup({
          name: "new",
          summary: "Author an artifact",
          retired: { archive: SENTENCE },
          commands: [leaf("spec")],
        }),
      ],
    });
    return { group, ran };
  }

  it("refuses a retired word at depth two with its sentence, the hint and 64", async () => {
    const held = artifact();
    const called = await call(programOf(held.group), {
      argv: ["artifact", "new", "archive", "docs/plans/x.md"],
    });
    expect(called.code).toBe(64);
    expect(called.err.join("")).toBe(`${SENTENCE}\nRun \`phax --help\` for usage.\n`);
    expect(held.ran).toEqual([]);
  });

  it("writes one refused line from the command under --json", async () => {
    const called = await call(programOf(artifact().group), {
      argv: ["artifact", "new", "archive", "--json"],
    });
    expect(lines(called.err)).toEqual([
      {
        kind: "refused",
        source: "command",
        path: ["artifact", "new", "archive"],
        expected: "a command of artifact new",
        text: SENTENCE,
        exit: 64,
      },
    ]);
  });

  it("never shows the retired word in help", async () => {
    const help = await call(programOf(artifact().group), { argv: ["artifact", "new", "--help"] });
    expect(help.code).toBe(0);
    expect(help.out.join("")).toContain("spec");
    expect(help.out.join("")).not.toContain("archive");
  });
});
