import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import type {
  Command,
  ExitCode,
  Group,
  Inputs,
  Runner,
  Terminal,
} from "../../contracts/command.ts";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  document,
  DocumentOutput,
  reject,
  strip,
} from "../define.ts";
import { utf8Bytes, Written, written } from "../written.ts";
import { memoryIo } from "./memory-io.ts";

export type Verdict =
  | { readonly held: true }
  | { readonly held: false; readonly why: string };

export interface Case {
  readonly id: string;
  readonly check: (runner: Runner) => Effect.Effect<Verdict>;
}

/** The codes the suite's programs choose, so that a runner hard-coding 2 or 70 fails. */
const REFUSED = 64;
const DEFECT = 99;
const MAPPED = 3;

class NotFound extends Data.TaggedError("NotFound")<{
  readonly id: string;
}> {}
class Unlisted extends Data.TaggedError("Unlisted")<{
  readonly id: string;
}> {}
class Gone extends Data.TaggedError("Gone")<{ readonly id: string }> {}

const Str = Schema.String;
const Switch = Schema.optionalKey(Schema.Boolean);
const Todos = Schema.Struct({ todos: Schema.Array(Schema.String) });

// ---------------------------------------------------------------- the commands

interface Recording {
  readonly command: Command<never>;
  /** The input each `run` received. */
  readonly seen: unknown[];
}

function recording(name: string, input: Inputs): Recording {
  const seen: unknown[] = [];
  const command = defineCommand({
    name,
    summary: `the ${name} command`,
    input,
    output: strip(Str),
    exits: {},
    run: (context) =>
      Effect.sync(() => {
        seen.push(context.input);
        return name;
      }),
    render: (text) => text,
  });
  return { command, seen };
}

const pair = () =>
  recording("pair", { args: reject(Schema.Tuple([Str, Str])) });
const opt = () =>
  recording("opt", {
    args: reject(Schema.Tuple([Str, Schema.optionalKey(Str)])),
  });
const oneReject = () => recording("one", { args: reject(Schema.Tuple([Str])) });
const oneStrip = () => recording("one", { args: strip(Schema.Tuple([Str])) });
const bare = () => recording("bare", {});
const move = () =>
  recording("move", {
    args: reject(Schema.Tuple([Str])),
    flags: reject(Schema.Struct({ to: Str })),
  });
const opts = () =>
  recording("opts", {
    flags: reject(Schema.Struct({ to: Str, dryRun: Switch })),
  });
const sw = () =>
  recording("sw", {
    args: reject(Schema.Tuple([Str])),
    flags: reject(Schema.Struct({ dryRun: Switch })),
  });
const tag = () =>
  recording("tag", {
    args: reject(Schema.Tuple([Str])),
    flags: strip(Schema.Struct({ to: Str })),
  });
const count = () =>
  recording("count", {
    flags: reject(Schema.Struct({ count: Schema.FiniteFromString })),
  });
const inStrip = () => recording("in-strip", { stdin: strip(Todos) });
const inReject = () => recording("in-reject", { stdin: reject(Todos) });
const envStrip = () =>
  recording("env-strip", {
    env: strip(Schema.Struct({ TODOS_DB: Str })),
  });
const envReject = () =>
  recording("env-reject", {
    env: reject(Schema.Struct({ TODOS_DB: Str })),
  });

/** A command whose run fails with `NotFound`, mapped to `MAPPED`. */
const finding = (name: string): Command<never> =>
  defineCommand({
    name,
    summary: "fails with NotFound",
    input: {},
    exits: { NotFound: MAPPED },
    run: () => Effect.fail(new NotFound({ id: "x" })),
    render: () => "",
  });

const Full = { id: "t1", name: "one", archived: false };

function showing(name: string, policy: typeof strip | typeof reject) {
  const received: unknown[] = [];
  const command = defineCommand({
    name,
    summary: `the ${name} command`,
    input: {},
    output: policy(Schema.Struct({ id: Str, name: Str })),
    exits: {},
    run: () => Effect.succeed(Full),
    render: (value, terminal) => {
      received.push({ value, terminal });
      return `${value.id} ${value.name}`;
    },
  });
  return { command, received };
}

// ---------------------------------------------------------------- the calls

const program = (...commands: ReadonlyArray<Command<never> | Group<never>>) =>
  defineProgram({
    name: "suite",
    version: "9.9.9",
    exits: { refused: REFUSED, defect: DEFECT },
    commands,
  });

interface CallOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string;
  /** Stdin is a terminal whose read never ends: a runner that evaluates it is caught by the
   *  count of evaluations. */
  readonly stdinIsTerminal?: boolean;
  /** The files that exist, by path, as text. */
  readonly files?: Readonly<Record<string, string>>;
  readonly terminal?: Terminal;
}

interface Called {
  readonly code: ExitCode;
  readonly out: string;
  readonly err: string;
  readonly reads: number;
  /** The paths the runner read through `io.readFile`. */
  readonly files: ReadonlyArray<string>;
  /** The files the runner wrote through `io.writeFile`, by path, as text. */
  readonly writes: Readonly<Record<string, string>>;
}

function call(
  runner: Runner,
  commands: ReadonlyArray<Command<never> | Group<never>>,
  argv: ReadonlyArray<string>,
  options: CallOptions = {},
): Effect.Effect<Called> {
  const memory = memoryIo({ argv, ...options });
  return runner.run(program(...commands), memory.io).pipe(
    Effect.map((code) => ({
      code,
      out: memory.out(),
      err: memory.err(),
      reads: memory.stdinReads(),
      files: memory.fileReads(),
      writes: memory.fileWrites(),
    })),
  );
}

// ---------------------------------------------------------------- the checks

type Check = string | undefined;

function verdict(...checks: ReadonlyArray<Check>): Verdict {
  const why = checks.filter((check): check is string => check !== undefined);
  return why.length === 0
    ? { held: true }
    : { held: false, why: why.join("; ") };
}

const show = (value: unknown): string => JSON.stringify(value) ?? "undefined";

function is(label: string, expected: unknown, actual: unknown): Check {
  return show(expected) === show(actual)
    ? undefined
    : `${label}: expected ${show(expected)}, got ${show(actual)}`;
}

const ended = (called: Called, code: ExitCode): Check =>
  is("exit code", code, called.code);

/** The word is one of `text`'s words, not a part of one. */
const names = (text: string, word: string): boolean =>
  text.split(/[\s:'",`=]+/).includes(word);

const naming = (called: Called, word: string): Check =>
  names(called.err, word)
    ? undefined
    : `err should name ${word}, got ${show(called.err)}`;

const has = (text: string, part: string): Check =>
  text.includes(part)
    ? undefined
    : `should contain ${show(part)}, got ${show(text)}`;

const lacks = (text: string, part: string): Check =>
  text.includes(part)
    ? `should not contain ${show(part)}, got ${show(text)}`
    : undefined;

const outEmpty = (called: Called): Check =>
  called.out === ""
    ? undefined
    : `out should be empty, got ${show(called.out)}`;

const errWritten = (called: Called): Check =>
  called.err === "" ? "err should be written, got nothing" : undefined;

/** Refused: the program's `refused` code, `out` empty, `err` written. */
const refusal = (called: Called): ReadonlyArray<Check> => [
  ended(called, REFUSED),
  outEmpty(called),
  errWritten(called),
];

/** A defect: `out` empty, `err` written, and no code that means something else. */
const defect = (called: Called): ReadonlyArray<Check> => {
  const others: ReadonlyArray<ExitCode> = [0, REFUSED, MAPPED];
  return [
    outEmpty(called),
    errWritten(called),
    others.includes(called.code)
      ? `exit code should be neither 0, ${REFUSED} nor ${MAPPED}, got ${called.code}`
      : undefined,
  ];
};

const ran = (recordings: ReadonlyArray<Recording>): Check => {
  const seen = recordings.flatMap((r) => r.seen);
  return seen.length === 0
    ? undefined
    : `no run should be called, got ${show(seen)}`;
};

// ---------------------------------------------------------------- the case builders

interface Reach {
  readonly options?: CallOptions;
  /** The input `run` receives, once. */
  readonly input: unknown;
}

/** The call reaches `run` with `input` and ends 0. */
const reaches = (
  id: string,
  make: () => Recording,
  argv: ReadonlyArray<string>,
  reach: Reach,
): Case => ({
  id,
  check: (runner) =>
    Effect.gen(function* () {
      const recorded = make();
      const called = yield* call(
        runner,
        [recorded.command],
        argv,
        reach.options,
      );
      return verdict(
        ended(called, 0),
        is("input run received", [reach.input], recorded.seen),
      );
    }),
});

/** The call is refused, no `run` is called, and `err` names `word` when one is given. */
const refuses = (
  id: string,
  make: () => Recording,
  argv: ReadonlyArray<string>,
  options: CallOptions & { readonly names?: string } = {},
): Case => ({
  id,
  check: (runner) =>
    Effect.gen(function* () {
      const recorded = make();
      const called = yield* call(runner, [recorded.command], argv, options);
      return verdict(
        ...refusal(called),
        ran([recorded]),
        options.names === undefined ? undefined : naming(called, options.names),
      );
    }),
});

const TODOS_JSON = JSON.stringify({ todos: [] });
const EXTRA_JSON = JSON.stringify({ todos: [], extra: 1 });
const WHOLE_ENV = { TODOS_DB: "db", PATH: "/bin" };

/** One program per defect, each with a mapped code beside it. */
interface DefectKind {
  readonly label: string;
  readonly command: Command<never>;
}

function defectKinds(): ReadonlyArray<DefectKind> {
  return [
    {
      label: "unmapped-tag",
      // `Unlisted` is not in `exits`: the types forbid it, so this is a defect only a bug makes.
      command: defineCommand({
        name: "unmapped",
        summary: "fails with a tag nothing maps",
        input: {},
        output: strip(Str),
        exits: { NotFound: MAPPED },
        run: () =>
          Effect.fail(new Unlisted({ id: "x" })) as unknown as Effect.Effect<
            string,
            NotFound
          >,
        render: (text) => text,
      }),
    },
    {
      label: "untagged",
      command: defineCommand({
        name: "untagged",
        summary: "fails with a plain value",
        input: {},
        output: strip(Str),
        exits: {},
        run: () => Effect.fail("boom") as unknown as Effect.Effect<string>,
        render: (text) => text,
      }),
    },
    {
      label: "die",
      command: defineCommand({
        name: "dies",
        summary: "dies",
        input: {},
        exits: {},
        run: () => Effect.die(new Error("boom")),
        render: () => "",
      }),
    },
    {
      label: "render-throws",
      command: defineCommand({
        name: "throws",
        summary: "renders by throwing",
        input: {},
        output: strip(Str),
        exits: {},
        run: () => Effect.succeed("x"),
        render: (): string => {
          throw new Error("boom");
        },
      }),
    },
    {
      label: "output-reject",
      command: showing("show-reject", reject).command,
    },
  ];
}

const defectCase = (kind: string): Case => ({
  id: `defect.${kind}`,
  check: (runner) =>
    Effect.gen(function* () {
      const found = defectKinds().find((d) => d.label === kind);
      if (found === undefined) return verdict(`no defect named ${kind}`);
      const called = yield* call(
        runner,
        [found.command, finding("find")],
        [found.command.name],
      );
      return verdict(...defect(called));
    }),
});

/** `ok` runs; `bad` maps `Gone` to the program's defect code. */
function collidingCommands(): {
  readonly ok: Recording;
  readonly bad: Command<never>;
} {
  return {
    ok: recording("ok", {}),
    bad: defineCommand({
      name: "bad",
      summary: "maps Gone to the defect code",
      input: {},
      exits: { Gone: DEFECT },
      run: () => Effect.fail(new Gone({ id: "x" })),
      render: () => "",
    }),
  };
}

// ---------------------------------------------------------------- the document cases

/** A document with a name, as the stdin refusals call its format. */
const Doc = Schema.Struct({ todos: Schema.Array(Schema.String) }).annotate({
  identifier: "todos",
});
const DOC_JSON = JSON.stringify({ todos: ["a"] });
const DOC_VALUE = { todos: ["a"] };

/** No flag bound: the document is always read. */
const unbound = () => recording("unbound", { stdin: reject(Doc) });
/** A flag bound, the document optional. */
const bound = () =>
  recording("bound", { stdin: reject(Doc, { flag: "request" }) });
/** A flag bound, the document required. */
const required = () =>
  recording("required", {
    stdin: reject(Doc, { flag: "request", required: true }),
  });

/** What the first case of the written-file fixture holds
 *  (`libraries/typescript/cli-command/tests/fixtures/written-record.json`, which a test of this
 *  package checks this against, and the Rust library reads): the bytes, and their record. */
export const WRITTEN_FIXTURE = {
  path: "out/a.json",
  bytes: `{\n  "$schema": "https://docs.steme.dev/schemas/ledger/1.0.0.json",\n  "entries": []\n}\n`,
  record: {
    path: "out/a.json",
    format: "https://docs.steme.dev/schemas/ledger/1.0.0.json",
    digest:
      "sha256:c205dfb2efd10c5cf7e32cae9d8b24cc4e704c13e78cb484ac098d29df13e4cb",
  },
} as const;

/** An output with a field whose encoded form is not its decoded one, and a `$schema` last. */
const Encoded = Schema.Struct({
  id: Str,
  count: Schema.FiniteFromString,
  $schema: Str,
});

// ---------------------------------------------------------------- the --json cases

/** The lines of a stream written under `--json`, parsed; `undefined` for a line that is not JSON. */
const parsedLines = (text: string): ReadonlyArray<unknown> =>
  text
    .split("\n")
    .filter((each) => each !== "")
    .map((each): unknown => {
      try {
        return JSON.parse(each);
      } catch {
        return undefined;
      }
    });

/** Every line of `text` is a compact JSON object on one line. */
const onlyMessages = (label: string, text: string): Check =>
  text === "" ||
  (text.endsWith("\n") &&
    text
      .slice(0, -1)
      .split("\n")
      .every((each) => {
        try {
          const parsed: unknown = JSON.parse(each);
          return (
            typeof parsed === "object" &&
            parsed !== null &&
            JSON.stringify(parsed) === each
          );
        } catch {
          return false;
        }
      }))
    ? undefined
    : `${label} should be compact JSON lines only, got ${show(text)}`;

/** An output with a `$schema` last, to be written first. */
const Item = Schema.Struct({ id: Str, name: Str, $schema: Str });

const ITEM_FORMAT = "https://example.test/schemas/item/1.0.0.json";

/** A command that answers `Full` and counts the renders it is asked for. */
function itemized(name: string) {
  const renders: unknown[] = [];
  const command = defineCommand({
    name,
    summary: `the ${name} command`,
    input: {},
    output: strip(Item),
    exits: {},
    run: () =>
      Effect.succeed({ id: "t1", name: "one", $schema: ITEM_FORMAT, extra: 1 }),
    render: (value) => {
      renders.push(value);
      return "rendered";
    },
  });
  return { command, renders };
}

/** The format and bytes of the document the document cases answer. */
const DOC_FORMAT = "https://example.test/schemas/doc/1.0.0.json";
const DOC_BYTES = `{\n  "$schema": "${DOC_FORMAT}",\n  "k": 1\n}\n`;
const DocOut = Schema.Struct({ ...DocumentOutput.fields, k: Schema.Number });
/** A file written beside the document. */
const BESIDE = {
  path: "beside.txt",
  format: null,
  digest: WRITTEN_FIXTURE.record.digest,
} as const;

/** A command that answers a document and does not write it to a file. */
function documenting(name: string) {
  const renders: unknown[] = [];
  const command = defineCommand({
    name,
    summary: `the ${name} command`,
    input: {},
    output: strip(DocOut),
    exits: {},
    run: () => Effect.succeed({ $schema: DOC_FORMAT, k: 1 }),
    render: (value) => {
      renders.push(value);
      return "rendered";
    },
    document: () =>
      document(DOC_BYTES, { format: DOC_FORMAT, written: [BESIDE] }),
  });
  return { command, renders };
}

/** The same, a command that writes a document: the runner owns its `--out`. */
function writing(name: string, flags: Inputs = {}) {
  return defineCommand({
    name,
    summary: `the ${name} command`,
    input: flags,
    output: strip(DocOut),
    exits: {},
    run: () => Effect.succeed({ $schema: DOC_FORMAT, k: 1 }),
    document: () => document(DOC_BYTES, { format: DOC_FORMAT }),
    writesDocument: true,
  });
}

class Partial extends Data.TaggedError("Partial")<{
  readonly reason: string;
  readonly written: ReadonlyArray<Written>;
}> {}

/** The program's catalogue and a command's, as a runner prints them. */
interface Printed {
  readonly called: Called;
  readonly parsed: unknown;
}

function printed(
  runner: Runner,
  commands: ReadonlyArray<Command<never> | Group<never>>,
  argv: ReadonlyArray<string>,
): Effect.Effect<Printed> {
  return call(runner, commands, argv).pipe(
    Effect.map((called) => {
      try {
        return { called, parsed: JSON.parse(called.out) as unknown };
      } catch {
        return { called, parsed: undefined };
      }
    }),
  );
}

const keysOf = (value: unknown): ReadonlyArray<string> =>
  typeof value === "object" && value !== null ? Object.keys(value) : [];

/** The `--json` cases of the table. */
const jsonCases: ReadonlyArray<Case> = [
  {
    id: "json.skips-render",
    check: (runner) =>
      Effect.gen(function* () {
        // `--json` writes the output's encoded form, `extra` stripped, and never asks for a render.
        const item = itemized("item");
        const called = yield* call(runner, [item.command], ["item", "--json"]);
        return verdict(
          ended(called, 0),
          is(
            "out",
            `${JSON.stringify({ $schema: ITEM_FORMAT, id: "t1", name: "one" }, null, 2)}\n`,
            called.out,
          ),
          is("err", "", called.err),
          is("renders", [], item.renders),
        );
      }),
  },
  {
    id: "json.reserved",
    check: (runner) =>
      Effect.gen(function* () {
        // A command declaring `--json` or `--json-schema` stops the program, whatever is called.
        const ok = recording("ok", {});
        const checks: Check[] = [];
        for (const option of ["--json", "--json-schema"] as const) {
          const clash = recording("loud", {
            flags: reject(
              option === "--json"
                ? Schema.Struct({ json: Switch })
                : Schema.Struct({ jsonSchema: Switch }),
            ),
          });
          const called = yield* call(
            runner,
            [ok.command, clash.command],
            ["ok"],
          );
          checks.push(
            // The exact defect code is `defect.code`'s: here, a defect and nothing else.
            ...defect(called),
            naming(called, "loud"),
            naming(called, option),
            ran([ok, clash]),
          );
        }
        return verdict(...checks);
      }),
  },
  {
    id: "json.schema-first",
    check: (runner) =>
      Effect.gen(function* () {
        // The contract lists `$schema` last; the written object has it first.
        const item = itemized("item");
        const called = yield* call(runner, [item.command], ["item", "--json"]);
        const keys = (() => {
          try {
            return keysOf(JSON.parse(called.out));
          } catch {
            return [];
          }
        })();
        return verdict(
          ended(called, 0),
          is("keys", ["$schema", "id", "name"], keys),
        );
      }),
  },
  {
    id: "document.unwrapped",
    check: (runner) =>
      Effect.gen(function* () {
        // A document is written as itself in both modes, a render is never asked for, and only
        // `--json` says on stderr which file was written beside it.
        const plain = documenting("doc");
        const as = documenting("doc");
        const text = yield* call(runner, [plain.command], ["doc"]);
        const json = yield* call(runner, [as.command], ["doc", "--json"]);
        return verdict(
          ended(text, 0),
          ended(json, 0),
          is("out without --json", DOC_BYTES, text.out),
          is("out with --json", DOC_BYTES, json.out),
          is("err without --json", "", text.err),
          is(
            "err with --json",
            [
              {
                kind: "written",
                path: BESIDE.path,
                format: BESIDE.format,
                digest: BESIDE.digest,
              },
            ],
            parsedLines(json.err),
          ),
          onlyMessages("err", json.err),
          is("renders", [], [...plain.renders, ...as.renders]),
        );
      }),
  },
  {
    id: "error.line",
    check: (runner) =>
      Effect.gen(function* () {
        const called = yield* call(
          runner,
          [finding("find")],
          ["find", "--json"],
        );
        return verdict(
          ended(called, MAPPED),
          outEmpty(called),
          is(
            "err",
            `{"kind":"error","error":"NotFound","exit":3,"fields":{"id":"x"},"written":[]}\n`,
            called.err,
          ),
        );
      }),
  },
  {
    id: "refused.line",
    check: (runner) =>
      Effect.gen(function* () {
        // `--count x` does not decode: one `refused` line naming the flags and the option as
        // written, whose text is the one written without `--json`.
        const recorded = count();
        const text = yield* call(
          runner,
          [recorded.command],
          ["count", "--count", "x"],
        );
        const json = yield* call(
          runner,
          [recorded.command],
          ["count", "--count", "x", "--json"],
        );
        const found = parsedLines(json.err);
        const only = found[0];
        const expected = Reflect.has(Object(only), "expected")
          ? Reflect.get(Object(only), "expected")
          : undefined;
        return verdict(
          ended(json, REFUSED),
          outEmpty(json),
          is("line count", 1, found.length),
          is("kind", "refused", Reflect.get(Object(only), "kind")),
          is("source", "flags", Reflect.get(Object(only), "source")),
          is("path", ["--count"], Reflect.get(Object(only), "path")),
          is("exit", REFUSED, Reflect.get(Object(only), "exit")),
          is("text", text.err.slice(0, -1), Reflect.get(Object(only), "text")),
          typeof expected === "string" && expected !== ""
            ? undefined
            : `expected should say what was expected, got ${show(expected)}`,
          is(
            "keys",
            ["kind", "source", "path", "expected", "text", "exit"],
            keysOf(only),
          ),
          ran([recorded]),
        );
      }),
  },
  {
    id: "defect.line",
    check: (runner) =>
      Effect.gen(function* () {
        const dies = defectKinds().find((d) => d.label === "die");
        if (dies === undefined) return verdict("no defect named die");
        const text = yield* call(runner, [dies.command], [dies.command.name]);
        const json = yield* call(
          runner,
          [dies.command],
          [dies.command.name, "--json"],
        );
        const found = parsedLines(json.err);
        const only = found[0];
        return verdict(
          // The exact defect code is `defect.code`'s: here, a defect, and the line says its code.
          ...defect(json),
          is("line count", 1, found.length),
          is("kind", "defect", Reflect.get(Object(only), "kind")),
          (() => {
            const exit: unknown = Reflect.get(Object(only), "exit");
            return typeof exit === "number" &&
              ![0, REFUSED, MAPPED].includes(exit)
              ? undefined
              : `the line's exit should be a defect code, got ${show(exit)}`;
          })(),
          is("text", text.err.slice(0, -1), Reflect.get(Object(only), "text")),
          is("keys", ["kind", "text", "exit"], keysOf(only)),
        );
      }),
  },
  {
    id: "notes.lines",
    check: (runner) =>
      Effect.gen(function* () {
        // Two lines of notes are two `note` lines; stdout is the encoded output, as ever.
        const noted = defineCommand({
          name: "noted",
          summary: "answers a record and two notes",
          input: {},
          output: strip(Item),
          exits: {},
          run: () =>
            Effect.succeed({ id: "t1", name: "one", $schema: ITEM_FORMAT }),
          notes: () => "first\nsecond\n",
        });
        const called = yield* call(runner, [noted], ["noted", "--json"]);
        const text = yield* call(runner, [noted], ["noted"]);
        return verdict(
          ended(called, 0),
          is(
            "out",
            `${JSON.stringify({ $schema: ITEM_FORMAT, id: "t1", name: "one" }, null, 2)}\n`,
            called.out,
          ),
          is(
            "err",
            `{"kind":"note","text":"first"}\n{"kind":"note","text":"second"}\n`,
            called.err,
          ),
          is("err without --json", "first\nsecond\n", text.err),
          is("out without --json", called.out, text.out),
        );
      }),
  },
  {
    id: "catalogue.program",
    check: (runner) =>
      Effect.gen(function* () {
        // The program prints every command's contracts and the shapes of the message lines, runs
        // nothing, reads nothing, writes nothing else.
        const recordings = [pair(), count(), inReject()];
        const got = yield* printed(
          runner,
          recordings.map((r) => r.command),
          ["--json-schema"],
        );
        const catalogue: unknown = got.parsed;
        const commands: unknown = Reflect.get(Object(catalogue), "commands");
        const names = Array.isArray(commands)
          ? commands.map((each: unknown) => Reflect.get(Object(each), "name"))
          : commands;
        return verdict(
          ended(got.called, 0),
          is("err", "", got.called.err),
          is("program", "suite", Reflect.get(Object(catalogue), "program")),
          is("version", "9.9.9", Reflect.get(Object(catalogue), "version")),
          is(
            "exits",
            { refused: REFUSED, defect: DEFECT },
            Reflect.get(Object(catalogue), "exits"),
          ),
          is("commands", [["pair"], ["count"], ["in-reject"]], names),
          is(
            "message kinds",
            ["defect", "error", "note", "refused", "written"],
            [...keysOf(Reflect.get(Object(catalogue), "messages"))].sort(),
          ),
          is("stdin reads", 0, got.called.reads),
          ran(recordings),
        );
      }),
  },
  {
    id: "catalogue.command",
    check: (runner) =>
      Effect.gen(function* () {
        // A command prints its own entry alone, equal to its entry in the program's.
        const recordings = [pair(), count()];
        const commands = recordings.map((r) => r.command);
        const whole = yield* printed(runner, commands, ["--json-schema"]);
        const one = yield* printed(runner, commands, [
          "count",
          "--json-schema",
        ]);
        const entries: unknown = Reflect.get(Object(whole.parsed), "commands");
        const entry = Array.isArray(entries)
          ? entries.find(
              (each: unknown) =>
                show(Reflect.get(Object(each), "name")) === show(["count"]),
            )
          : undefined;
        return verdict(
          ended(one.called, 0),
          is("err", "", one.called.err),
          is("entry", entry, one.parsed),
          is(
            "entry keys",
            ["name", "input", "stdin", "output", "errors"],
            keysOf(one.parsed),
          ),
          ran(recordings),
        );
      }),
  },
  {
    id: "out.path",
    check: (runner) =>
      Effect.gen(function* () {
        // `--out <path>` and `--out=<path>` write the document's bytes and answer the record of
        // the file, whose digest is the SHA-256 of those bytes.
        const bytes = utf8Bytes(DOC_BYTES);
        const record = yield* written("a.json", bytes);
        const expected = `${JSON.stringify(record, null, 2)}\n`;
        const apart = yield* call(
          runner,
          [writing("emit")],
          ["emit", "--out", "a.json"],
        );
        const attached = yield* call(
          runner,
          [writing("emit")],
          ["emit", "--out=a.json"],
        );
        const json = yield* call(
          runner,
          [writing("emit")],
          ["emit", "--out", "a.json", "--json"],
        );
        return verdict(
          ended(apart, 0),
          is("out", expected, apart.out),
          is("file", { "a.json": DOC_BYTES }, apart.writes),
          is("out attached", expected, attached.out),
          is("file attached", { "a.json": DOC_BYTES }, attached.writes),
          is("out with --json", expected, json.out),
          is("record format", DOC_FORMAT, record.format),
        );
      }),
  },
  {
    id: "out.dash",
    check: (runner) =>
      Effect.gen(function* () {
        // `--out -` and no `--out` write no file and answer the document.
        const dash = yield* call(
          runner,
          [writing("emit")],
          ["emit", "--out", "-"],
        );
        const equals = yield* call(
          runner,
          [writing("emit")],
          ["emit", "--out=-"],
        );
        const none = yield* call(runner, [writing("emit")], ["emit"]);
        return verdict(
          ended(dash, 0),
          is("out --out -", DOC_BYTES, dash.out),
          is("out --out=-", DOC_BYTES, equals.out),
          is("out", DOC_BYTES, none.out),
          is("files", {}, { ...dash.writes, ...equals.writes, ...none.writes }),
        );
      }),
  },
  {
    id: "out.reserved",
    check: (runner) =>
      Effect.gen(function* () {
        // A command that writes a document and declares `out` stops the program; one that does
        // not write a document keeps its own `--out`.
        const clash = writing("emit", {
          flags: reject(Schema.Struct({ out: Str })),
        });
        const ok = recording("ok", {});
        const own = recording("own", {
          flags: reject(Schema.Struct({ out: Str })),
        });
        const stopped = yield* call(runner, [ok.command, clash], ["ok"]);
        const kept = yield* call(runner, [own.command], ["own", "--out", "x"]);
        return verdict(
          ...defect(stopped),
          naming(stopped, "emit"),
          naming(stopped, "--out"),
          ran([ok]),
          ended(kept, 0),
          is("own out", [{ flags: { out: "x" } }], own.seen),
        );
      }),
  },
  {
    id: "error.written",
    check: (runner) =>
      Effect.gen(function* () {
        // An error that wrote a file lists its record in the line's `written`, not in `fields`.
        const partial = defineCommand({
          name: "partial",
          summary: "fails after writing a file",
          input: {},
          exits: { Partial: MAPPED },
          run: () =>
            Effect.fail(
              new Partial({
                reason: "disk",
                written: [WRITTEN_FIXTURE.record],
              }),
            ),
        });
        const called = yield* call(runner, [partial], ["partial", "--json"]);
        return verdict(
          ended(called, MAPPED),
          outEmpty(called),
          is(
            "err",
            `${JSON.stringify({
              kind: "error",
              error: "Partial",
              exit: MAPPED,
              fields: { reason: "disk" },
              written: [WRITTEN_FIXTURE.record],
            })}\n`,
            called.err,
          ),
        );
      }),
  },
];

// ---------------------------------------------------------------- the groups, the usage spec and the long help

class NoDebt extends Data.TaggedError("NoDebt")<{ readonly id: string }> {}
class NoEntry extends Data.TaggedError("NoEntry")<{ readonly id: string }> {}

const NO_DEBT = 4;
const NO_ENTRY = 5;

/** A group `debt` of two commands, each with its own input and code, and what their runs received. */
function debt() {
  const runs: unknown[] = [];
  const accept = defineCommand({
    name: "accept",
    summary: "Accept a debt",
    input: {
      args: reject(Schema.Tuple([Str])),
      flags: reject(Schema.Struct({ why: Str })),
    },
    output: strip(Schema.Struct({ id: Str, why: Str })),
    exits: { NoDebt: NO_DEBT },
    run: ({ input }) =>
      Effect.gen(function* () {
        runs.push(input);
        const [id] = input.args;
        if (id === "9") return yield* new NoDebt({ id });
        return { id, why: input.flags.why };
      }),
    render: (value) => `accepted ${value.id}`,
  });
  const withdraw = defineCommand({
    name: "withdraw",
    summary: "Withdraw a debt",
    input: { args: reject(Schema.Tuple([Str])) },
    output: strip(Schema.Struct({ id: Str })),
    exits: { NoEntry: NO_ENTRY },
    run: ({ input }) =>
      Effect.gen(function* () {
        runs.push(input);
        const [id] = input.args;
        if (id === "9") return yield* new NoEntry({ id });
        return { id };
      }),
    render: (value) => `withdrawn ${value.id}`,
  });
  const group = defineGroup({
    name: "debt",
    summary: "Accept or withdraw a debt",
    commands: [accept, withdraw],
  });
  return { group, runs };
}

/** The lines of a usage spec that belong to the command called `name`, its children included
 *  until the next `cmd` node. */
function blockOf(spec: string, name: string): ReadonlyArray<string> {
  const lines = spec.split("\n");
  const start = lines.findIndex((each) =>
    each.trimStart().startsWith(`cmd ${name} `),
  );
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((each) => each.trimStart().startsWith("cmd "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The block has a `flag` node for each of `--json` and `--json-schema`, with their help. */
const declaresJson = (spec: string, name: string): ReadonlyArray<Check> =>
  ["flag --json help=", "flag --json-schema help="].map((node) =>
    blockOf(spec, name).some((each) => each.trimStart().startsWith(node))
      ? undefined
      : `${name} should declare ${node}…`,
  );

const groupCases: ReadonlyArray<Case> = [
  {
    id: "groups.own-contracts",
    check: (runner) =>
      Effect.gen(function* () {
        // Each command of a group parses its own input and answers its own codes.
        const answers: ReadonlyArray<
          readonly [ReadonlyArray<string>, ExitCode]
        > = [
          [["debt", "accept", "1", "--why", "x"], 0],
          [["debt", "accept", "9", "--why", "x"], NO_DEBT],
          [["debt", "withdraw", "1"], 0],
          [["debt", "withdraw", "9"], NO_ENTRY],
        ];
        const checks: Check[] = [];
        for (const [argv, code] of answers) {
          const { group } = debt();
          const called = yield* call(runner, [group], argv);
          checks.push(is(argv.join(" "), code, called.code));
        }
        // A word of its own is refused for a command that does not declare it, and `help` is no
        // command of the group.
        const stray = debt();
        const withStray = yield* call(
          runner,
          [stray.group],
          ["debt", "withdraw", "1", "--why", "x"],
        );
        const helper = debt();
        const withHelp = yield* call(runner, [helper.group], ["debt", "help"]);
        // The group alone writes its help on stderr and is refused.
        const unnamed = debt();
        const alone = yield* call(runner, [unnamed.group], ["debt"]);
        // Its own help is answered, on stdout.
        const shown = debt();
        const help = yield* call(runner, [shown.group], ["debt", "--help"]);
        return verdict(
          ...checks,
          ...refusal(withStray),
          naming(withStray, "--why"),
          is("runs after a refused option", [], stray.runs),
          ...refusal(withHelp),
          is("runs after debt help", [], helper.runs),
          ...refusal(alone),
          naming(alone, "accept"),
          naming(alone, "withdraw"),
          is("runs after the group alone", [], unnamed.runs),
          ended(help, 0),
          is("err of debt --help", "", help.err),
          is(
            "out of debt --help lists both commands",
            [true, true],
            [names(help.out, "accept"), names(help.out, "withdraw")],
          ),
        );
      }),
  },
  {
    id: "json.grouped",
    check: (runner) =>
      Effect.gen(function* () {
        // A grouped command answers JSON, a declared error line, and its contracts, as it would
        // alone; the usage spec declares `--json` and `--json-schema` on every command.
        const accepted = yield* call(
          runner,
          [debt().group],
          ["debt", "accept", "1", "--why", "x", "--json"],
        );
        const refused = yield* call(
          runner,
          [debt().group],
          ["debt", "withdraw", "9", "--json"],
        );
        const lone = bare();
        const commands = [debt().group, lone.command];
        const whole = yield* printed(runner, commands, ["--json-schema"]);
        const one = yield* printed(runner, commands, [
          "debt",
          "accept",
          "--json-schema",
        ]);
        const spec = yield* call(runner, commands, ["--usage-spec"]);
        const entries: unknown = Reflect.get(Object(whole.parsed), "commands");
        const accept = Array.isArray(entries)
          ? entries.find(
              (each: unknown) =>
                show(Reflect.get(Object(each), "name")) ===
                show(["debt", "accept"]),
            )
          : undefined;
        return verdict(
          ended(accepted, 0),
          is(
            "out",
            `${JSON.stringify({ id: "1", why: "x" }, null, 2)}\n`,
            accepted.out,
          ),
          is("err", "", accepted.err),
          ended(refused, NO_ENTRY),
          outEmpty(refused),
          is(
            "error line",
            `{"kind":"error","error":"NoEntry","exit":5,"fields":{"id":"9"},"written":[]}\n`,
            refused.err,
          ),
          is(
            "catalogue names",
            [["debt", "accept"], ["debt", "withdraw"], ["bare"]],
            Array.isArray(entries)
              ? entries.map((each: unknown) =>
                  Reflect.get(Object(each), "name"),
                )
              : entries,
          ),
          ended(one.called, 0),
          is("entry of a grouped command", accept, one.parsed),
          ended(spec, 0),
          ...["accept", "withdraw", "bare"].flatMap((name) =>
            declaresJson(spec.out, name),
          ),
          ran([lone]),
        );
      }),
  },
  {
    id: "usage.from-definitions",
    check: (runner) =>
      Effect.gen(function* () {
        // The usage spec is KDL, written from the definitions: the program's header, each
        // positional by its name, the help, default and choices its schema declares, a group with
        // its commands under it, and `--json` and `--json-schema` on every command.
        const shown = recording("show", {
          args: reject(
            Schema.Tuple([
              Schema.String.annotate({
                identifier: "id",
                description: "The todo's id",
              }),
              Schema.optionalKey(Str),
            ]),
          ),
          flags: reject(
            Schema.Struct({
              mode: Schema.optionalKey(
                Schema.Literals(["a", "b"]).annotate({
                  description: "The mode",
                }),
              ),
              level: Str.annotate({ description: "How loud" }).pipe(
                Schema.withDecodingDefaultKey(Effect.succeed("low")),
              ),
              dryRun: Switch,
            }),
          ),
        });
        const commands = [shown.command, debt().group];
        const called = yield* call(runner, commands, ["--usage-spec"]);
        const spec = called.out;
        const lines = spec.split("\n");
        const header = lines.findIndex((each) => each.startsWith("cmd debt "));
        return verdict(
          ended(called, 0),
          is("err", "", called.err),
          is(
            "header",
            ["name suite", "bin suite", 'version "9.9.9"'],
            lines.slice(0, 3),
          ),
          has(spec, `arg <id> help="The todo's id"`),
          has(spec, `arg "[arg1]"`),
          // its first positional is named, so never `arg0`
          lacks(blockOf(spec, "show").join("\n"), "arg0"),
          has(spec, `flag "--mode <mode>" help="The mode"`),
          has(spec, "choices a b"),
          has(spec, `flag "--level <level>" help="How loud" default="low"`),
          has(spec, "flag --dry-run"),
          is(
            "the group's header",
            `cmd debt help="Accept or withdraw a debt" subcommand_required=#true {`,
            lines[header],
          ),
          is(
            "a command nested under the group",
            true,
            lines
              .slice(header + 1)
              .some((each) => each.startsWith("    cmd accept ")),
          ),
          ...["show", "accept", "withdraw"].flatMap((name) =>
            declaresJson(spec, name),
          ),
          ran([shown]),
        );
      }),
  },
  {
    id: "help.long-and-examples",
    check: (runner) =>
      Effect.gen(function* () {
        // A long help and examples show on the command's `--help` and in the usage spec; a
        // command without them says nothing beyond its summary.
        const documented = recording("docs", {});
        const explained = defineCommand({
          name: "explain",
          summary: "Explain a topic",
          help: "Explains a topic in depth.\nIt takes the topic.",
          examples: ["suite explain intro", "suite explain intro --json"],
          input: { args: reject(Schema.Tuple([Str])) },
          output: strip(Str),
          exits: {},
          run: () => Effect.succeed("x"),
          render: (text) => text,
        });
        const commands = [explained, documented.command];
        const help = yield* call(runner, commands, ["explain", "--help"]);
        const plain = yield* call(runner, commands, ["docs", "--help"]);
        const spec = yield* call(runner, commands, ["--usage-spec"]);
        const block = blockOf(spec.out, "explain");
        return verdict(
          ended(help, 0),
          is("err", "", help.err),
          has(help.out, "Explains a topic in depth."),
          has(help.out, "It takes the topic."),
          has(help.out, "Examples:"),
          has(help.out, "suite explain intro"),
          has(help.out, "suite explain intro --json"),
          ended(plain, 0),
          lacks(plain.out, "Examples:"),
          has(
            spec.out,
            `long_help="Explains a topic in depth.\\nIt takes the topic."`,
          ),
          is(
            "the examples, first in their command's block",
            [
              `    example "suite explain intro"`,
              `    example "suite explain intro --json"`,
            ],
            block.slice(0, 2),
          ),
          is(
            "no example for a command without any",
            false,
            spec.out.includes(`example "suite docs`),
          ),
          ran([documented]),
        );
      }),
  },
];

// ---------------------------------------------------------------- the table

export const cases: ReadonlyArray<Case> = [
  reaches("args.by-position", pair, ["pair", "a", "b"], {
    input: { args: ["a", "b"] },
  }),
  reaches("args.optional-absent", opt, ["opt", "a"], {
    input: { args: ["a"] },
  }),
  refuses("args.reject.surplus", oneReject, ["one", "a", "b"], { names: "b" }),
  reaches("args.strip.surplus", oneStrip, ["one", "a", "b"], {
    input: { args: ["a"] },
  }),
  refuses("args.missing", oneReject, ["one"]),
  refuses("args.undeclared", bare, ["bare", "x"]),
  {
    // `--` ends the options (POSIX guideline 10): the first one is consumed, and every word after
    // it is a positional argument, a dash-word and a second `--` too.
    id: "args.after-double-dash",
    check: (runner) =>
      Effect.gen(function* () {
        const moved = move();
        const first = yield* call(
          runner,
          [moved.command],
          ["move", "--to", "one", "--", "-x"],
        );
        const paired = pair();
        const second = yield* call(
          runner,
          [paired.command],
          ["pair", "--", "--", "-x"],
        );
        return verdict(
          ended(first, 0),
          ended(second, 0),
          is(
            "input run received",
            [{ args: ["-x"], flags: { to: "one" } }],
            moved.seen,
          ),
          is("input run received", [{ args: ["--", "-x"] }], paired.seen),
        );
      }),
  },
  refuses(
    "args.reject.surplus-after-double-dash",
    oneReject,
    ["one", "--", "a", "-b"],
    { names: "-b" },
  ),
  reaches("flags.kebab-case", opts, ["opts", "--to", "one", "--dry-run"], {
    input: { flags: { to: "one", dryRun: true } },
  }),
  reaches("flags.switch-takes-no-value", sw, ["sw", "--dry-run", "a"], {
    input: { args: ["a"], flags: { dryRun: true } },
  }),
  reaches("flags.optional-absent", opts, ["opts", "--to", "one"], {
    input: { flags: { to: "one" } },
  }),
  reaches("flags.attached-dash-value", opts, ["opts", "--to=-5"], {
    input: { flags: { to: "-5" } },
  }),
  refuses("flags.reject.undeclared", opts, ["opts", "--to", "one", "--force"], {
    names: "--force",
  }),
  refuses("flags.missing", opts, ["opts"]),
  refuses("flags.undeclared", bare, ["bare", "--x"]),
  {
    id: "flags.strip.undeclared-dropped-alone",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = tag();
        const first = yield* call(
          runner,
          [recorded.command],
          ["tag", "t1", "--to", "one", "--force"],
        );
        const second = yield* call(
          runner,
          [recorded.command],
          ["tag", "t1", "--force=yes", "--to", "one"],
        );
        const input = { args: ["t1"], flags: { to: "one" } };
        return verdict(
          ended(first, 0),
          ended(second, 0),
          is("inputs run received", [input, input], recorded.seen),
        );
      }),
  },
  refuses(
    "flags.strip.word-after-is-its-own",
    tag,
    ["tag", "t1", "--force", "yes", "--to", "one"],
    { names: "yes" },
  ),
  {
    id: "source.strings",
    check: (runner) =>
      Effect.gen(function* () {
        const good = count();
        const given = yield* call(
          runner,
          [good.command],
          ["count", "--count", "3"],
        );
        const bad = count();
        const refused = yield* call(
          runner,
          [bad.command],
          ["count", "--count", "x"],
        );
        return verdict(
          ended(given, 0),
          is("input run received", [{ flags: { count: 3 } }], good.seen),
          ...refusal(refused),
          ran([bad]),
        );
      }),
  },
  {
    id: "stdin.json-once",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = inStrip();
        const called = yield* call(runner, [recorded.command], ["in-strip"], {
          stdin: TODOS_JSON,
        });
        return verdict(
          ended(called, 0),
          is("input run received", [{ stdin: { todos: [] } }], recorded.seen),
          is("stdin evaluations", 1, called.reads),
        );
      }),
  },
  refuses("stdin.reject.undeclared-key", inReject, ["in-reject"], {
    stdin: EXTRA_JSON,
  }),
  reaches("stdin.strip.undeclared-key", inStrip, ["in-strip"], {
    options: { stdin: EXTRA_JSON },
    input: { stdin: { todos: [] } },
  }),
  refuses("stdin.not-json", inReject, ["in-reject"], { stdin: "not json" }),
  {
    id: "stdin.untouched",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = bare();
        const called = yield* call(runner, [recorded.command], ["bare"], {
          stdin: TODOS_JSON,
        });
        return verdict(
          ended(called, 0),
          is("stdin evaluations", 0, called.reads),
        );
      }),
  },
  reaches("env.strip.whole-environment", envStrip, ["env-strip"], {
    options: { env: WHOLE_ENV },
    input: { env: { TODOS_DB: "db" } },
  }),
  refuses("env.reject.whole-environment", envReject, ["env-reject"], {
    env: WHOLE_ENV,
    names: "PATH",
  }),
  reaches("env.reject.declared-only", envReject, ["env-reject"], {
    options: { env: { TODOS_DB: "db" } },
    input: { env: { TODOS_DB: "db" } },
  }),
  refuses("call.unknown-command", bare, ["frobnicate"]),
  refuses("call.no-command", bare, []),
  {
    id: "refused.runs-nothing",
    check: (runner) =>
      Effect.gen(function* () {
        const recordings = [opts(), oneReject(), count(), inReject()];
        const commands = recordings.map((r) => r.command);
        const calls: ReadonlyArray<readonly [ReadonlyArray<string>, string?]> =
          [
            [["opts", "--to", "one", "--force"]],
            [["one", "a", "b"]],
            [["one"]],
            [["count", "--count", "x"]],
            [["in-reject"], "not json"],
          ];
        const problems: Check[] = [];
        for (const [argv, stdin] of calls) {
          const called = yield* call(
            runner,
            commands,
            argv,
            stdin === undefined ? {} : { stdin },
          );
          problems.push(ended(called, REFUSED));
        }
        return verdict(...problems, ran(recordings));
      }),
  },
  {
    id: "output.strip.reduced",
    check: (runner) =>
      Effect.gen(function* () {
        const terminal = { columns: 40, color: false };
        const shown = showing("show", strip);
        const called = yield* call(runner, [shown.command], ["show"], {
          terminal,
        });
        return verdict(
          ended(called, 0),
          is(
            "what render received",
            [{ value: { id: "t1", name: "one" }, terminal }],
            shown.received,
          ),
          called.out.includes("t1 one")
            ? undefined
            : `out should hold the rendered text "t1 one", got ${show(called.out)}`,
        );
      }),
  },
  {
    id: "output.none.as-is",
    check: (runner) =>
      Effect.gen(function* () {
        const items = ["a", "b"];
        const received: unknown[] = [];
        // The types refuse a value answered without an output contract; a command that gets
        // there anyway (a plain object, an older definition) is handed its value as is.
        const list: Command<never> = {
          name: "list",
          summary: "lists",
          input: {},
          exits: {},
          run: () => Effect.succeed(items),
          render: (value: ReadonlyArray<string>) => {
            received.push(value);
            return value.join(",");
          },
        };
        const called = yield* call(runner, [list], ["list"]);
        return verdict(
          ended(called, 0),
          received.length === 1 && received[0] === items
            ? undefined
            : `render should receive the very array run succeeded with, got ${show(received)}`,
        );
      }),
  },
  {
    id: "output.reject.extra-key",
    check: (runner) =>
      Effect.gen(function* () {
        const shown = showing("show-reject", reject);
        const called = yield* call(runner, [shown.command], ["show-reject"]);
        return verdict(
          outEmpty(called),
          errWritten(called),
          called.code === 0 || called.code === REFUSED
            ? `exit code should be neither 0 nor ${REFUSED}, got ${called.code}`
            : undefined,
        );
      }),
  },
  {
    id: "exits.mapped",
    check: (runner) =>
      Effect.gen(function* () {
        const called = yield* call(runner, [finding("find")], ["find"]);
        return verdict(
          ended(called, MAPPED),
          outEmpty(called),
          errWritten(called),
        );
      }),
  },
  {
    id: "exits.refused-shared",
    check: (runner) =>
      Effect.gen(function* () {
        const shared = defineCommand({
          name: "shared",
          summary: "maps a tag to the refused code",
          input: {},
          exits: { NotFound: REFUSED },
          run: () => Effect.fail(new NotFound({ id: "x" })),
          render: () => "",
        });
        const called = yield* call(runner, [shared], ["shared"]);
        return verdict(ended(called, REFUSED));
      }),
  },
  defectCase("unmapped-tag"),
  defectCase("untagged"),
  defectCase("die"),
  defectCase("render-throws"),
  {
    id: "defect.command-maps-defect-code",
    check: (runner) =>
      Effect.gen(function* () {
        const { ok, bad } = collidingCommands();
        const called = yield* call(runner, [ok.command, bad], ["ok"]);
        return verdict(
          called.code === 0
            ? "exit code should not be 0, the program is refused"
            : undefined,
          outEmpty(called),
          naming(called, "bad"),
          naming(called, String(DEFECT)),
          ran([ok]),
        );
      }),
  },
  {
    id: "defect.code",
    check: (runner) =>
      Effect.gen(function* () {
        const problems: Check[] = [];
        for (const kind of defectKinds()) {
          const called = yield* call(
            runner,
            [kind.command, finding("find")],
            [kind.command.name],
          );
          problems.push(is(`exit code of ${kind.label}`, DEFECT, called.code));
        }
        const { ok, bad } = collidingCommands();
        const colliding = yield* call(runner, [ok.command, bad], ["ok"]);
        problems.push(
          is("exit code of command-maps-defect-code", DEFECT, colliding.code),
        );
        return verdict(...problems);
      }),
  },
  {
    id: "help.program",
    check: (runner) =>
      Effect.gen(function* () {
        const recordings = [opts(), oneReject(), count()];
        const commands = recordings.map((r) => r.command);
        const problems: Check[] = [];
        for (const flag of ["--help", "-h"]) {
          const called = yield* call(runner, commands, [flag]);
          problems.push(ended(called, 0));
          for (const command of commands) {
            for (const word of [command.name, command.summary]) {
              if (!called.out.includes(word)) {
                problems.push(
                  `${flag}: out should name ${show(word)}, got ${show(called.out)}`,
                );
              }
            }
          }
        }
        return verdict(...problems, ran(recordings));
      }),
  },
  {
    id: "help.command",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = opts();
        const called = yield* call(
          runner,
          [recorded.command],
          ["opts", "--help"],
        );
        return verdict(
          ended(called, 0),
          ...["--to", "--dry-run"].map((word) =>
            called.out.includes(word)
              ? undefined
              : `out should name ${word}, got ${show(called.out)}`,
          ),
          ran([recorded]),
        );
      }),
  },
  {
    id: "version",
    check: (runner) =>
      Effect.gen(function* () {
        const called = yield* call(runner, [bare().command], ["--version"]);
        return verdict(
          ended(called, 0),
          called.out.includes("9.9.9")
            ? undefined
            : `out should contain 9.9.9, got ${show(called.out)}`,
        );
      }),
  },
  {
    id: "output.encoded-without-render",
    check: (runner) =>
      Effect.gen(function* () {
        // No render: out is the encoded form (`count` as the string it encodes to), indented by
        // two spaces, a newline after, `$schema` first although the contract lists it last.
        const SCHEMA = "https://example.test/schemas/item/1.0.0.json";
        const item = defineCommand({
          name: "item",
          summary: "answers a record and no render",
          input: {},
          output: strip(Encoded),
          exits: {},
          run: () =>
            Effect.succeed({ id: "t1", count: 3, $schema: SCHEMA, extra: 1 }),
        });
        const called = yield* call(runner, [item], ["item"]);
        const expected = `${JSON.stringify({ $schema: SCHEMA, id: "t1", count: "3" }, null, 2)}\n`;
        return verdict(
          ended(called, 0),
          is("out", expected, called.out),
          is("err", "", called.err),
        );
      }),
  },
  {
    id: "stdin.flag-sources",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = bound();
        const flag = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request"],
          {
            stdin: DOC_JSON,
          },
        );
        const dash = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request", "-"],
          { stdin: DOC_JSON },
        );
        const equals = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request=-"],
          { stdin: DOC_JSON },
        );
        const file = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request=in.json"],
          { stdin: '{"todos":["not this"]}', files: { "in.json": DOC_JSON } },
        );
        const input = { stdin: DOC_VALUE };
        return verdict(
          ended(flag, 0),
          ended(dash, 0),
          ended(equals, 0),
          ended(file, 0),
          is(
            "inputs run received",
            [input, input, input, input],
            recorded.seen,
          ),
          is("stdin evaluations of --request", 1, flag.reads),
          is("stdin evaluations of --request -", 1, dash.reads),
          is("stdin evaluations of --request=-", 1, equals.reads),
          is("stdin evaluations of --request=<path>", 0, file.reads),
          is("files read of --request=<path>", ["in.json"], file.files),
          is("files read of --request", [], flag.files),
        );
      }),
  },
  {
    id: "stdin.piped",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = unbound();
        const called = yield* call(runner, [recorded.command], ["unbound"], {
          stdin: DOC_JSON,
        });
        return verdict(
          ended(called, 0),
          is("input run received", [{ stdin: DOC_VALUE }], recorded.seen),
          is("stdin evaluations", 1, called.reads),
        );
      }),
  },
  {
    id: "stdin.terminal-refused",
    check: (runner) =>
      Effect.gen(function* () {
        const plain = unbound();
        const first = yield* call(runner, [plain.command], ["unbound"], {
          stdin: DOC_JSON,
          stdinIsTerminal: true,
        });
        const flagged = bound();
        const second = yield* call(
          runner,
          [flagged.command],
          ["bound", "--request"],
          { stdin: DOC_JSON, stdinIsTerminal: true },
        );
        return verdict(
          ...refusal(first),
          naming(first, "todos"),
          is("stdin evaluations, no flag bound", 0, first.reads),
          ...refusal(second),
          naming(second, "todos"),
          naming(second, "--request"),
          is("stdin evaluations, flag bound", 0, second.reads),
          ran([plain, flagged]),
        );
      }),
  },
  {
    id: "stdin.flag-absent-unread",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = bound();
        const called = yield* call(runner, [recorded.command], ["bound"], {
          stdin: DOC_JSON,
        });
        const [received] = recorded.seen;
        return verdict(
          ended(called, 0),
          is("runs", 1, recorded.seen.length),
          is(
            "document run received",
            undefined,
            (received as { readonly stdin?: unknown } | undefined)?.stdin,
          ),
          is("stdin evaluations", 0, called.reads),
          is("files read", [], called.files),
        );
      }),
  },
  {
    id: "stdin.required-flag-absent",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = required();
        const called = yield* call(runner, [recorded.command], ["required"], {
          stdin: DOC_JSON,
        });
        return verdict(
          ...refusal(called),
          naming(called, "--request"),
          is("stdin evaluations", 0, called.reads),
          ran([recorded]),
        );
      }),
  },
  {
    id: "stdin.unreadable-refused",
    check: (runner) =>
      Effect.gen(function* () {
        const recorded = bound();
        const missing = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request=missing.json"],
        );
        const extra = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request", "-"],
          { stdin: JSON.stringify({ todos: [], extra: 1 }) },
        );
        const notJson = yield* call(
          runner,
          [recorded.command],
          ["bound", "--request", "-"],
          { stdin: "not json" },
        );
        return verdict(
          ...refusal(missing),
          naming(missing, "missing.json"),
          ...refusal(extra),
          naming(extra, "extra"),
          ...refusal(notJson),
          ran([recorded]),
        );
      }),
  },
  {
    id: "written.record",
    check: (runner) =>
      Effect.gen(function* () {
        // A command answers the record `written` makes of the fixture's first file; the runner
        // prints its encoded form, which is the fixture's expected record.
        const make = defineCommand({
          name: "make",
          summary: "answers the record of a written file",
          input: {},
          output: strip(Written),
          exits: {},
          run: () =>
            written(WRITTEN_FIXTURE.path, utf8Bytes(WRITTEN_FIXTURE.bytes)),
        });
        const called = yield* call(runner, [make], ["make"]);
        return verdict(
          ended(called, 0),
          is(
            "out",
            `${JSON.stringify(WRITTEN_FIXTURE.record, null, 2)}\n`,
            called.out,
          ),
        );
      }),
  },
  ...jsonCases,
  ...groupCases,
];
