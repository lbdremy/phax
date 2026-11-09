// The library's conformance cases, ported to Effect 3 with their ids and meanings unchanged, and
// one case per gain the port carries for upstream (each marked `Gain:` where it stands). The
// cases are frozen: phase-02's runner passes them, nothing edits them.
import { Data, Effect } from "effect";
import * as Schema from "effect/Schema";
import type {
  Command,
  ExitCode,
  Group,
  Inputs,
  Program,
  ProgramUsage,
  Runner,
  Terminal,
} from "../command.js";
import {
  defineCommand,
  defineGroup,
  defineProgram,
  document,
  DocumentOutput,
  Refused,
  reject,
  strip,
} from "../define.js";
import { AliasAnnotationId, CompleterAnnotationId, OptionalValueAnnotationId } from "../shapes.js";
import { usageSpec } from "../usage.js";
import { utf8Bytes, Written, written } from "../written.js";
import { memoryIo } from "./memoryIo.js";

type Verdict = { readonly held: true } | { readonly held: false; readonly why: string };

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

const pair = () => recording("pair", { args: reject(Schema.Tuple(Str, Str)) });
const opt = () =>
  recording("opt", {
    args: reject(Schema.Tuple(Str, Schema.optionalElement(Str))),
  });
const oneReject = () => recording("one", { args: reject(Schema.Tuple(Str)) });
const oneStrip = () => recording("one", { args: strip(Schema.Tuple(Str)) });
const bare = () => recording("bare", {});
const move = () =>
  recording("move", {
    args: reject(Schema.Tuple(Str)),
    flags: reject(Schema.Struct({ to: Str })),
  });
const opts = () =>
  recording("opts", {
    flags: reject(Schema.Struct({ to: Str, dryRun: Switch })),
  });
const sw = () =>
  recording("sw", {
    args: reject(Schema.Tuple(Str)),
    flags: reject(Schema.Struct({ dryRun: Switch })),
  });
const tag = () =>
  recording("tag", {
    args: reject(Schema.Tuple(Str)),
    flags: strip(Schema.Struct({ to: Str })),
  });
const count = () =>
  recording("count", {
    flags: reject(Schema.Struct({ count: Schema.NumberFromString })),
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

/** Gain: the suite's program with a usage flag or options of its own. */
const programWith = (
  extra: {
    readonly usage?: ProgramUsage;
    readonly options?: NonNullable<Program<never>["options"]>;
  },
  ...commands: ReadonlyArray<Command<never> | Group<never>>
) =>
  defineProgram({
    name: "suite",
    version: "9.9.9",
    exits: { refused: REFUSED, defect: DEFECT },
    commands,
    ...extra,
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
  /** Each write to `out` and `err`, in the order made. */
  readonly streams: ReadonlyArray<{ readonly stream: "out" | "err"; readonly text: string }>;
}

function call(
  runner: Runner,
  commands: ReadonlyArray<Command<never> | Group<never>>,
  argv: ReadonlyArray<string>,
  options: CallOptions = {},
): Effect.Effect<Called> {
  return callProgram(runner, program(...commands), argv, options);
}

function callProgram(
  runner: Runner,
  called: Program<never>,
  argv: ReadonlyArray<string>,
  options: CallOptions = {},
): Effect.Effect<Called> {
  const memory = memoryIo({ argv, ...options });
  return runner.run(called, memory.io).pipe(
    Effect.map((code) => ({
      code,
      out: memory.out(),
      err: memory.err(),
      reads: memory.stdinReads(),
      files: memory.fileReads(),
      writes: memory.fileWrites(),
      streams: memory.writes(),
    })),
  );
}

// ---------------------------------------------------------------- the checks

type Check = string | undefined;

function verdict(...checks: ReadonlyArray<Check>): Verdict {
  const why = checks.filter((check): check is string => check !== undefined);
  return why.length === 0 ? { held: true } : { held: false, why: why.join("; ") };
}

const show = (value: unknown): string => JSON.stringify(value) ?? "undefined";

function is(label: string, expected: unknown, actual: unknown): Check {
  return show(expected) === show(actual)
    ? undefined
    : `${label}: expected ${show(expected)}, got ${show(actual)}`;
}

const ended = (called: Called, code: ExitCode): Check => is("exit code", code, called.code);

/** The word is one of `text`'s words, not a part of one. */
const names = (text: string, word: string): boolean => text.split(/[\s:'",`=]+/).includes(word);

const naming = (called: Called, word: string): Check =>
  names(called.err, word) ? undefined : `err should name ${word}, got ${show(called.err)}`;

const has = (text: string, part: string): Check =>
  text.includes(part) ? undefined : `should contain ${show(part)}, got ${show(text)}`;

const lacks = (text: string, part: string): Check =>
  text.includes(part) ? `should not contain ${show(part)}, got ${show(text)}` : undefined;

const outEmpty = (called: Called): Check =>
  called.out === "" ? undefined : `out should be empty, got ${show(called.out)}`;

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
  return seen.length === 0 ? undefined : `no run should be called, got ${show(seen)}`;
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
      const called = yield* call(runner, [recorded.command], argv, reach.options);
      return verdict(ended(called, 0), is("input run received", [reach.input], recorded.seen));
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
          Effect.fail(new Unlisted({ id: "x" })) as unknown as Effect.Effect<string, NotFound>,
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
      const called = yield* call(runner, [found.command, finding("find")], [found.command.name]);
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
const Doc = Schema.Struct({ todos: Schema.Array(Schema.String) }).annotations({
  identifier: "todos",
});
const DOC_JSON = JSON.stringify({ todos: ["a"] });
const DOC_VALUE = { todos: ["a"] };

/** No flag bound: the document is always read. */
const unbound = () => recording("unbound", { stdin: reject(Doc) });
/** A flag bound, the document optional. */
const bound = () => recording("bound", { stdin: reject(Doc, { flag: "request" }) });
/** A flag bound, the document required. */
const required = () =>
  recording("required", {
    stdin: reject(Doc, { flag: "request", required: true }),
  });

/** What the first case of the written-file fixture holds
 *  (`tests/unit/commandLibrary/contract/fixtures/written-record.json`, which a test checks this
 *  against, and the library's Rust twin reads): the bytes, and their record. */
export const WRITTEN_FIXTURE = {
  path: "out/a.json",
  bytes: `{\n  "$schema": "https://docs.steme.dev/schemas/ledger/1.0.0.json",\n  "entries": []\n}\n`,
  record: {
    path: "out/a.json",
    format: "https://docs.steme.dev/schemas/ledger/1.0.0.json",
    digest: "sha256:c205dfb2efd10c5cf7e32cae9d8b24cc4e704c13e78cb484ac098d29df13e4cb",
  },
} as const;

/** An output with a field whose encoded form is not its decoded one, and a `$schema` last. */
const Encoded = Schema.Struct({
  id: Str,
  count: Schema.NumberFromString,
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
          return typeof parsed === "object" && parsed !== null && JSON.stringify(parsed) === each;
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
    run: () => Effect.succeed({ id: "t1", name: "one", $schema: ITEM_FORMAT, extra: 1 }),
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
    document: () => document(DOC_BYTES, { format: DOC_FORMAT, written: [BESIDE] }),
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
          const called = yield* call(runner, [ok.command, clash.command], ["ok"]);
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
        return verdict(ended(called, 0), is("keys", ["$schema", "id", "name"], keys));
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
        const called = yield* call(runner, [finding("find")], ["find", "--json"]);
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
        // written, whose text is the one written without `--json`, and whose expected value
        // names what the transformation decodes into, not the schema (`NumberFromString`).
        const recorded = count();
        const text = yield* call(runner, [recorded.command], ["count", "--count", "x"]);
        const json = yield* call(runner, [recorded.command], ["count", "--count", "x", "--json"]);
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
          is("expected", 'Expected number, actual "x"', expected),
          is("keys", ["kind", "source", "path", "expected", "text", "exit"], keysOf(only)),
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
        const json = yield* call(runner, [dies.command], [dies.command.name, "--json"]);
        const found = parsedLines(json.err);
        const only = found[0];
        return verdict(
          // The exact defect code is `defect.code`'s: here, a defect, and the line says its code.
          ...defect(json),
          is("line count", 1, found.length),
          is("kind", "defect", Reflect.get(Object(only), "kind")),
          (() => {
            const exit: unknown = Reflect.get(Object(only), "exit");
            return typeof exit === "number" && ![0, REFUSED, MAPPED].includes(exit)
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
          run: () => Effect.succeed({ id: "t1", name: "one", $schema: ITEM_FORMAT }),
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
        const listed = Array.isArray(commands)
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
          is("commands", [["pair"], ["count"], ["in-reject"]], listed),
          is(
            "message kinds",
            ["defect", "error", "note", "refused", "written"],
            keysOf(Reflect.get(Object(catalogue), "messages")).toSorted(),
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
        const one = yield* printed(runner, commands, ["count", "--json-schema"]);
        const entries: unknown = Reflect.get(Object(whole.parsed), "commands");
        const entry = Array.isArray(entries)
          ? entries.find(
              (each: unknown) => show(Reflect.get(Object(each), "name")) === show(["count"]),
            )
          : undefined;
        return verdict(
          ended(one.called, 0),
          is("err", "", one.called.err),
          is("entry", entry, one.parsed),
          is("entry keys", ["name", "input", "stdin", "output", "errors"], keysOf(one.parsed)),
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
        const apart = yield* call(runner, [writing("emit")], ["emit", "--out", "a.json"]);
        const attached = yield* call(runner, [writing("emit")], ["emit", "--out=a.json"]);
        const json = yield* call(runner, [writing("emit")], ["emit", "--out", "a.json", "--json"]);
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
        const dash = yield* call(runner, [writing("emit")], ["emit", "--out", "-"]);
        const equals = yield* call(runner, [writing("emit")], ["emit", "--out=-"]);
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
      args: reject(Schema.Tuple(Str)),
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
    input: { args: reject(Schema.Tuple(Str)) },
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
  const start = lines.findIndex((each) => each.trimStart().startsWith(`cmd ${name} `));
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
        const answers: ReadonlyArray<readonly [ReadonlyArray<string>, ExitCode]> = [
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
        const refused = yield* call(runner, [debt().group], ["debt", "withdraw", "9", "--json"]);
        const lone = bare();
        const commands = [debt().group, lone.command];
        const whole = yield* printed(runner, commands, ["--json-schema"]);
        const one = yield* printed(runner, commands, ["debt", "accept", "--json-schema"]);
        const spec = yield* call(runner, commands, ["--usage-spec"]);
        const entries: unknown = Reflect.get(Object(whole.parsed), "commands");
        const accept = Array.isArray(entries)
          ? entries.find(
              (each: unknown) =>
                show(Reflect.get(Object(each), "name")) === show(["debt", "accept"]),
            )
          : undefined;
        return verdict(
          ended(accepted, 0),
          is("out", `${JSON.stringify({ id: "1", why: "x" }, null, 2)}\n`, accepted.out),
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
              ? entries.map((each: unknown) => Reflect.get(Object(each), "name"))
              : entries,
          ),
          ended(one.called, 0),
          is("entry of a grouped command", accept, one.parsed),
          ended(spec, 0),
          ...["accept", "withdraw", "bare"].flatMap((name) => declaresJson(spec.out, name)),
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
            Schema.Tuple(
              Schema.String.annotations({
                identifier: "id",
                description: "The todo's id",
              }),
              Schema.optionalElement(Str),
            ),
          ),
          flags: reject(
            Schema.Struct({
              mode: Schema.optionalKey(
                Schema.Literal("a", "b").annotations({
                  description: "The mode",
                }),
              ),
              level: Schema.optionalWith(Str.annotations({ description: "How loud" }), {
                default: () => "low",
              }),
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
          is("header", ["name suite", "bin suite", 'version "9.9.9"'], lines.slice(0, 3)),
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
            lines.slice(header + 1).some((each) => each.startsWith("    cmd accept ")),
          ),
          ...["show", "accept", "withdraw"].flatMap((name) => declaresJson(spec, name)),
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
          input: { args: reject(Schema.Tuple(Str)) },
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
          has(spec.out, `long_help="Explains a topic in depth.\\nIt takes the topic."`),
          is(
            "the examples, first in their command's block",
            [`    example "suite explain intro"`, `    example "suite explain intro --json"`],
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

// ---------------------------------------------------------------- the gains

/** Gain (groups holding groups): a group `outer` holding a command `top` and a group `inner`,
 *  which holds a command `leaf` taking one argument. */
function nested() {
  const top = recording("top", {});
  const leaf = recording("leaf", { args: reject(Schema.Tuple(Str)) });
  const inner = defineGroup({
    name: "inner",
    summary: "The inner group",
    commands: [leaf.command],
  });
  const group = defineGroup({
    name: "outer",
    summary: "The outer group",
    commands: [top.command, inner],
  });
  return { group, top, leaf };
}

/** Gain (completers): two named arguments, each declaring the completer of its candidates. */
const ShortName = Schema.String.annotations({
  identifier: "short-name",
  description: "The run's short name",
  [CompleterAnnotationId]: { run: "suite ls --complete", descriptions: true },
});
const PlanPath = Schema.String.annotations({
  identifier: "plan",
  [CompleterAnnotationId]: { run: "suite plans --complete", descriptions: false },
});

/** Gain (verdict codes): a lint whose report answers 1 when it holds an error. */
const Report = Schema.Struct({ errors: Schema.Number });
const linting = () =>
  defineCommand({
    name: "lint",
    summary: "lints a thing",
    input: { args: reject(Schema.Tuple(Str)) },
    output: strip(Report),
    exits: {},
    verdicts: { 1: (report) => report.errors > 0 },
    run: ({ input }) => Effect.succeed({ errors: input.args[0] === "bad" ? 1 : 0 }),
    render: (report) => `${report.errors} errors`,
  });

/** Gain (a text stdin document): a Markdown brief, which is no JSON. */
const BRIEF = "# Brief\n\nNot { JSON.\n";

/** Gain (options for every command): what each run received, its input and the program's options. */
function observed(name: string, input: Inputs) {
  const seen: unknown[] = [];
  const command = defineCommand({
    name,
    summary: `the ${name} command`,
    input,
    output: strip(Str),
    exits: {},
    run: (context) =>
      Effect.sync(() => {
        seen.push({ input: context.input, program: context.program });
        return name;
      }),
    render: (text) => text,
  });
  return { command, seen };
}

const ProgramOptions = reject(Schema.Struct({ verbose: Switch, trace: Switch }));

/** A case that needs no runner: what it checks is the contract's own (`usageSpec`). */
const contractOnly = (id: string, check: () => Verdict): Case => ({
  id,
  check: () => Effect.sync(check),
});

const linesOf = (spec: string): ReadonlyArray<string> => spec.split("\n");
const firstCommand = (spec: string): number =>
  linesOf(spec).findIndex((each) => each.startsWith("cmd "));

const gainCases: ReadonlyArray<Case> = [
  {
    // Gain: groups holding groups. A group called alone, at any depth, writes its help on stderr
    // and is refused, running nothing; its own `--help` is answered on stdout.
    id: "groups.nested-alone-refused",
    check: (runner) =>
      Effect.gen(function* () {
        const first = nested();
        const outer = yield* call(runner, [first.group], ["outer"]);
        const second = nested();
        const inner = yield* call(runner, [second.group], ["outer", "inner"]);
        const third = nested();
        const help = yield* call(runner, [third.group], ["outer", "inner", "--help"]);
        return verdict(
          ...refusal(outer),
          naming(outer, "top"),
          naming(outer, "inner"),
          ran([first.top, first.leaf]),
          ...refusal(inner),
          naming(inner, "leaf"),
          ran([second.top, second.leaf]),
          ended(help, 0),
          is("err of outer inner --help", "", help.err),
          names(help.out, "leaf")
            ? undefined
            : `out of outer inner --help should name leaf, got ${show(help.out)}`,
          ran([third.top, third.leaf]),
        );
      }),
  },
  {
    // Gain: groups holding groups. A nested command runs under its chain of group names, which is
    // its name in the catalogue and its place in the usage spec.
    id: "groups.nested-run",
    check: (runner) =>
      Effect.gen(function* () {
        const deep = nested();
        const leaf = yield* call(runner, [deep.group], ["outer", "inner", "leaf", "1"]);
        const shallow = nested();
        const top = yield* call(runner, [shallow.group], ["outer", "top"]);
        const whole = yield* printed(runner, [nested().group], ["--json-schema"]);
        const one = yield* printed(
          runner,
          [nested().group],
          ["outer", "inner", "leaf", "--json-schema"],
        );
        const spec = yield* call(runner, [nested().group], ["--usage-spec"]);
        const entries: unknown = Reflect.get(Object(whole.parsed), "commands");
        const entry = Array.isArray(entries)
          ? entries.find(
              (each: unknown) =>
                show(Reflect.get(Object(each), "name")) === show(["outer", "inner", "leaf"]),
            )
          : undefined;
        const lines = linesOf(spec.out);
        const outerAt = lines.findIndex((each) => each.startsWith("cmd outer "));
        const innerAt = lines.findIndex((each) => each.startsWith("    cmd inner "));
        const leafAt = lines.findIndex((each) => each.startsWith("        cmd leaf "));
        return verdict(
          ended(leaf, 0),
          is("input leaf received", [{ args: ["1"] }], deep.leaf.seen),
          has(leaf.out, "leaf"),
          ended(top, 0),
          is("top runs", 1, shallow.top.seen.length),
          is(
            "catalogue names",
            [
              ["outer", "top"],
              ["outer", "inner", "leaf"],
            ],
            Array.isArray(entries)
              ? entries.map((each: unknown) => Reflect.get(Object(each), "name"))
              : entries,
          ),
          ended(one.called, 0),
          is("entry of a nested command", entry, one.parsed),
          ended(spec, 0),
          is(
            "the outer group's header",
            `cmd outer help="The outer group" subcommand_required=#true {`,
            lines[outerAt],
          ),
          is(
            "the inner group's header",
            `    cmd inner help="The inner group" subcommand_required=#true {`,
            lines[innerAt],
          ),
          outerAt !== -1 && outerAt < innerAt && innerAt < leafAt
            ? undefined
            : `leaf should nest under inner under outer, got ${show(spec.out)}`,
          ...declaresJson(spec.out, "leaf"),
        );
      }),
  },
  // Gain: completers. One top-level `complete` node per distinct identifier whose argument
  // declares a completer, in declaration order, before the first command.
  contractOnly("usage.complete-nodes", () => {
    const resume = recording("resume", { args: reject(Schema.Tuple(ShortName)) });
    const open = recording("open", { args: reject(Schema.Tuple(PlanPath, ShortName)) });
    const spec = usageSpec(program(resume.command, open.command));
    const lines = linesOf(spec);
    const completes = lines.filter((each) => each.startsWith("complete "));
    const lastComplete = lines.findLastIndex((each) => each.startsWith("complete "));
    return verdict(
      is(
        "complete nodes",
        [
          `complete "short-name" run="suite ls --complete" descriptions=#true`,
          `complete "plan" run="suite plans --complete"`,
        ],
        completes,
      ),
      lastComplete !== -1 && lastComplete < firstCommand(spec)
        ? undefined
        : `the complete nodes should come before the first command, got ${show(spec)}`,
      has(spec, `arg <short-name> help="The run's short name"`),
      has(spec, "arg <plan>"),
    );
  }),
  {
    // Gain: verdict codes. An output answering a declared verdict code is written in both modes,
    // and the call exits with that code; an output answering none exits 0. The command's
    // contracts list its verdict codes.
    id: "exits.verdict-code",
    check: (runner) =>
      Effect.gen(function* () {
        const text = yield* call(runner, [linting()], ["lint", "bad"]);
        const json = yield* call(runner, [linting()], ["lint", "bad", "--json"]);
        const clean = yield* call(runner, [linting()], ["lint", "good"]);
        const entry = yield* printed(runner, [linting()], ["lint", "--json-schema"]);
        return verdict(
          ended(text, 1),
          has(text.out, "1 errors"),
          is("err without --json", "", text.err),
          ended(json, 1),
          is("out with --json", `${JSON.stringify({ errors: 1 }, null, 2)}\n`, json.out),
          is("err with --json", "", json.err),
          ended(clean, 0),
          has(clean.out, "0 errors"),
          is("verdicts of the entry", [1], Reflect.get(Object(entry.parsed), "verdicts")),
        );
      }),
  },
  {
    // Gain: verdict codes. A verdict code equal to the program's defect or refused code, or to 0,
    // stops the program: nothing runs, the offending command is named, the defect code ends it.
    id: "exits.verdict-collides",
    check: (runner) =>
      Effect.gen(function* () {
        const checks: Check[] = [];
        for (const code of [DEFECT, REFUSED, 0]) {
          const ok = recording("ok", {});
          const runs: unknown[] = [];
          const loud = defineCommand({
            name: "loud",
            summary: `answers ${code} as a verdict`,
            input: {},
            output: strip(Str),
            exits: {},
            verdicts: { [code]: () => true },
            run: () =>
              Effect.sync(() => {
                runs.push(code);
                return "x";
              }),
          });
          const called = yield* call(runner, [ok.command, loud], ["ok"]);
          checks.push(
            ...defect(called),
            is(`exit code with verdict ${code}`, DEFECT, called.code),
            naming(called, "loud"),
            ran([ok]),
            is(`runs of loud with verdict ${code}`, [], runs),
          );
        }
        return verdict(...checks);
      }),
  },
  {
    // Gain: a text stdin document. The text reaches run as read, from stdin or from the file the
    // flag names, under the reading and refusal rules of a JSON document.
    id: "stdin.text-document",
    check: (runner) =>
      Effect.gen(function* () {
        const piped = recording("piped", { stdin: strip(Schema.String, { text: true }) });
        const fromStdin = yield* call(runner, [piped.command], ["piped"], { stdin: BRIEF });
        const briefed = () =>
          recording("brief", { stdin: reject(Schema.String, { flag: "brief", text: true }) });
        const byFile = briefed();
        const file = yield* call(runner, [byFile.command], ["brief", "--brief=brief.md"], {
          stdin: "not this",
          files: { "brief.md": BRIEF },
        });
        const byDash = briefed();
        const dash = yield* call(runner, [byDash.command], ["brief", "--brief=-"], {
          stdin: BRIEF,
        });
        const onTerminal = briefed();
        const terminal = yield* call(runner, [onTerminal.command], ["brief", "--brief=-"], {
          stdin: BRIEF,
          stdinIsTerminal: true,
        });
        const unreadable = briefed();
        const missing = yield* call(runner, [unreadable.command], ["brief", "--brief=missing.md"]);
        const empty = recording("empty", {
          stdin: reject(Schema.String.pipe(Schema.minLength(1)), { text: true }),
        });
        const undecoded = yield* call(runner, [empty.command], ["empty"], { stdin: "" });
        return verdict(
          ended(fromStdin, 0),
          is("text run received from stdin", [{ stdin: BRIEF }], piped.seen),
          is("stdin evaluations of stdin", 1, fromStdin.reads),
          ended(file, 0),
          is("text run received from the file", [{ stdin: BRIEF }], byFile.seen),
          is("stdin evaluations of --brief=<path>", 0, file.reads),
          is("files read of --brief=<path>", ["brief.md"], file.files),
          ended(dash, 0),
          is("text run received from --brief=-", [{ stdin: BRIEF }], byDash.seen),
          ...refusal(terminal),
          naming(terminal, "--brief"),
          is("stdin evaluations on a terminal", 0, terminal.reads),
          ran([onTerminal]),
          ...refusal(missing),
          naming(missing, "missing.md"),
          ran([unreadable]),
          ...refusal(undecoded),
          ran([empty]),
        );
      }),
  },
  {
    // Gain: a required stdin-flag value. The flag takes `<file|->`, spaced or attached; the flag
    // alone is refused without reading; the contracts and the usage spec show `<file|->`.
    id: "stdin.flag-value-required",
    check: (runner) =>
      Effect.gen(function* () {
        const valued = () =>
          recording("decide", {
            stdin: reject(Doc, { flag: "verdicts", required: true, valueRequired: true }),
          });
        const received = valued();
        const files = { "in.json": DOC_JSON };
        const spacedFile = yield* call(
          runner,
          [received.command],
          ["decide", "--verdicts", "in.json"],
          {
            stdin: '{"todos":["not this"]}',
            files,
          },
        );
        const attachedFile = yield* call(
          runner,
          [received.command],
          ["decide", "--verdicts=in.json"],
          {
            stdin: '{"todos":["not this"]}',
            files,
          },
        );
        const spacedDash = yield* call(runner, [received.command], ["decide", "--verdicts", "-"], {
          stdin: DOC_JSON,
        });
        const attachedDash = yield* call(runner, [received.command], ["decide", "--verdicts=-"], {
          stdin: DOC_JSON,
        });
        const flagAlone = valued();
        const alone = yield* call(runner, [flagAlone.command], ["decide", "--verdicts"], {
          stdin: DOC_JSON,
        });
        const entry = yield* printed(runner, [valued().command], ["decide", "--json-schema"]);
        const spec = yield* call(runner, [valued().command], ["--usage-spec"]);
        const input = { stdin: DOC_VALUE };
        return verdict(
          ended(spacedFile, 0),
          ended(attachedFile, 0),
          ended(spacedDash, 0),
          ended(attachedDash, 0),
          is("inputs run received", [input, input, input, input], received.seen),
          is("files read of --verdicts <path>", ["in.json"], spacedFile.files),
          is("stdin evaluations of --verdicts <path>", 0, spacedFile.reads),
          is("stdin evaluations of --verdicts=<path>", 0, attachedFile.reads),
          is("stdin evaluations of --verdicts -", 1, spacedDash.reads),
          is("stdin evaluations of --verdicts=-", 1, attachedDash.reads),
          ...refusal(alone),
          naming(alone, "--verdicts"),
          is("stdin evaluations of --verdicts alone", 0, alone.reads),
          ran([flagAlone]),
          is(
            "the entry's stdin flag",
            "--verdicts <file|->",
            Reflect.get(Object(Reflect.get(Object(entry.parsed), "stdin")), "flag"),
          ),
          has(spec.out, `flag "--verdicts <file|->"`),
        );
      }),
  },
  {
    // Gain: progress notes. A progress note reaches `err` while run runs — a `note` line under
    // `--json`, its text and a newline without — before `out` gets the output.
    id: "notes.progress-streamed",
    check: (runner) =>
      Effect.gen(function* () {
        const progressed = (seenAtStep: string[], err: () => string) =>
          defineCommand({
            name: "steps",
            summary: "reports two steps, then answers",
            input: {},
            output: strip(Item),
            exits: {},
            run: ({ progress }) =>
              Effect.gen(function* () {
                yield* progress("step one");
                seenAtStep.push(err());
                yield* progress("step two");
                return { id: "t1", name: "one", $schema: ITEM_FORMAT };
              }),
          });
        const run = (argv: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const memory = memoryIo({ argv });
            const seenAtStep: string[] = [];
            const code = yield* runner.run(program(progressed(seenAtStep, memory.err)), memory.io);
            return { code, seenAtStep, writes: memory.writes(), out: memory.out() };
          });
        const json = yield* run(["steps", "--json"]);
        const text = yield* run(["steps"]);
        const encoded = `${JSON.stringify({ $schema: ITEM_FORMAT, id: "t1", name: "one" }, null, 2)}\n`;
        return verdict(
          is("exit code with --json", 0, json.code),
          is(
            "err written by the first step, with --json",
            [`{"kind":"note","text":"step one"}\n`],
            json.seenAtStep,
          ),
          is(
            "the writes with --json, in order",
            [
              { stream: "err", text: `{"kind":"note","text":"step one"}\n` },
              { stream: "err", text: `{"kind":"note","text":"step two"}\n` },
              { stream: "out", text: encoded },
            ],
            json.writes,
          ),
          is("exit code without --json", 0, text.code),
          is("err written by the first step, without --json", ["step one\n"], text.seenAtStep),
          is(
            "the writes without --json, in order",
            [
              { stream: "err", text: "step one\n" },
              { stream: "err", text: "step two\n" },
              { stream: "out", text: encoded },
            ],
            text.writes,
          ),
        );
      }),
  },
  {
    // Gain: a declared error's text form. Without `--json` the error's sentence for a person is
    // written, and its code ends the call; with `--json`, only its `error` line.
    id: "error.text-form",
    check: (runner) =>
      Effect.gen(function* () {
        const sentenced = defineCommand({
          name: "find",
          summary: "fails with NotFound, worded for a person",
          input: {},
          exits: { NotFound: MAPPED },
          texts: { NotFound: (error) => `no todo named ${error.id}` },
          run: () => Effect.fail(new NotFound({ id: "x" })),
        });
        const text = yield* call(runner, [sentenced], ["find"]);
        const json = yield* call(runner, [sentenced], ["find", "--json"]);
        return verdict(
          ended(text, MAPPED),
          outEmpty(text),
          is("err without --json", "no todo named x\n", text.err),
          ended(json, MAPPED),
          outEmpty(json),
          is(
            "err with --json",
            `{"kind":"error","error":"NotFound","exit":${MAPPED},"fields":{"id":"x"},"written":[]}\n`,
            json.err,
          ),
        );
      }),
  },
  {
    // Gain: the text a command had reached. A declared error's text form may give the lines a
    // person read on stdout before the failure: without `--json` they are written on stdout, then
    // the sentence on stderr; with `--json`, only the `error` line.
    id: "error.text-reached",
    check: (runner) =>
      Effect.gen(function* () {
        const reached = defineCommand({
          name: "find",
          summary: "fails with NotFound after a line for a person",
          input: {},
          exits: { NotFound: MAPPED },
          texts: {
            NotFound: (error) => ({ out: "looking", err: `no todo named ${error.id}` }),
          },
          run: () => Effect.fail(new NotFound({ id: "x" })),
        });
        const text = yield* call(runner, [reached], ["find"]);
        const json = yield* call(runner, [reached], ["find", "--json"]);
        return verdict(
          ended(text, MAPPED),
          is("out without --json", "looking\n", text.out),
          is("err without --json", "no todo named x\n", text.err),
          ended(json, MAPPED),
          outEmpty(json),
          is(
            "err with --json",
            `{"kind":"error","error":"NotFound","exit":${MAPPED},"fields":{"id":"x"},"written":[]}\n`,
            json.err,
          ),
        );
      }),
  },
  {
    // Gain: the program's usage flag. The runner answers the flag the program names (and its
    // format option, `kdl`) with the usage spec, which lists that flag in place of the hidden
    // `--usage-spec`; `--usage-spec` is then no flag of the program.
    id: "usage.program-flag",
    check: (runner) =>
      Effect.gen(function* () {
        const named = () =>
          programWith({ usage: { flag: "usage", format: "usage-format" } }, bare().command);
        const expected = usageSpec(named());
        const plain = yield* callProgram(runner, named(), ["--usage"]);
        const formatted = yield* callProgram(runner, named(), ["--usage", "--usage-format", "kdl"]);
        const library = yield* callProgram(runner, named(), ["--usage-spec"]);
        return verdict(
          ended(plain, 0),
          is("out of --usage", expected, plain.out),
          is("err of --usage", "", plain.err),
          ended(formatted, 0),
          is("out of --usage --usage-format kdl", expected, formatted.out),
          ...refusal(library),
          has(expected, `flag --usage help=`),
          has(expected, `flag "--usage-format <format>" help=`),
          lacks(expected, "--usage-spec"),
        );
      }),
  },
  // Gain: where the usage spec lists `--json-schema`. Once at the root, as a global flag, when
  // the program says so; on every command otherwise, as the library does. `--json` stays on
  // every command.
  contractOnly("usage.json-schema-listing", () => {
    const once = usageSpec(
      programWith(
        { usage: { flag: "usage", jsonSchema: "program" } },
        debt().group,
        bare().command,
      ),
    );
    const every = usageSpec(
      programWith({ usage: { flag: "usage" } }, debt().group, bare().command),
    );
    const explicit = usageSpec(
      programWith(
        { usage: { flag: "usage", jsonSchema: "every-command" } },
        debt().group,
        bare().command,
      ),
    );
    const commands = ["accept", "withdraw", "bare"];
    return verdict(
      linesOf(once).some((each) => each.startsWith("flag --json-schema global=#true help="))
        ? undefined
        : `the root should declare a global --json-schema, got ${show(once)}`,
      ...commands.map((name) =>
        blockOf(once, name).some((each) => each.trimStart().startsWith("flag --json-schema"))
          ? `${name} should not declare --json-schema when the program lists it once`
          : undefined,
      ),
      ...commands.map((name) =>
        blockOf(once, name).some((each) => each.trimStart().startsWith("flag --json help="))
          ? undefined
          : `${name} should declare --json`,
      ),
      ...commands.flatMap((name) => declaresJson(every, name)),
      is("every-command is the default", every, explicit),
      linesOf(every).some((each) => each.startsWith("flag --json-schema global=#true"))
        ? `the root's --json-schema should not be global when every command lists it, got ${show(every)}`
        : undefined,
    );
  }),
  // Gain: the program's exits documented. The usage spec says the program's `refused` and
  // `defect` codes at the root, before its commands.
  contractOnly("usage.program-exits", () => {
    const spec = usageSpec(program(bare().command));
    const lines = linesOf(spec);
    const at = lines.findIndex((each) => each.startsWith("after_long_help "));
    const line = lines[at] ?? "";
    return verdict(
      at !== -1 && at < firstCommand(spec)
        ? undefined
        : `the root should say its exits before its commands, got ${show(spec)}`,
      has(line, `${REFUSED}  refused`),
      has(line, `${DEFECT}  defect`),
    );
  }),
  {
    // Gain: options for every command. The program's options are decoded once from the call's
    // words wherever they stand, and handed to every run as `program`; an undeclared option is
    // still refused; the usage spec writes them as global flags.
    id: "options.program-wide",
    check: (runner) =>
      Effect.gen(function* () {
        const checks: Check[] = [];
        const calls: ReadonlyArray<readonly [ReadonlyArray<string>, unknown]> = [
          [["--verbose", "pair", "a", "b"], { verbose: true }],
          [["pair", "a", "--trace", "b"], { trace: true }],
          [["pair", "a", "b", "--verbose", "--trace"], { verbose: true, trace: true }],
          [["pair", "a", "b"], {}],
        ];
        for (const [argv, options] of calls) {
          const pairing = observed("pair", { args: reject(Schema.Tuple(Str, Str)) });
          const called = yield* callProgram(
            runner,
            programWith({ options: ProgramOptions }, pairing.command),
            argv,
          );
          checks.push(
            ended(called, 0),
            is(
              `what ${argv.join(" ")} ran with`,
              [{ input: { args: ["a", "b"] }, program: options }],
              pairing.seen,
            ),
          );
        }
        const withdrawing = observed("withdraw", { args: reject(Schema.Tuple(Str)) });
        const grouped = yield* callProgram(
          runner,
          programWith(
            { options: ProgramOptions },
            defineGroup({ name: "debt", summary: "Debts", commands: [withdrawing.command] }),
          ),
          ["debt", "--verbose", "withdraw", "1"],
        );
        const stray = observed("pair", { args: reject(Schema.Tuple(Str, Str)) });
        const refused = yield* callProgram(
          runner,
          programWith({ options: ProgramOptions }, stray.command),
          ["pair", "a", "b", "--loud"],
        );
        const spec = yield* callProgram(
          runner,
          programWith({ options: ProgramOptions }, observed("pair", {}).command),
          ["--usage-spec"],
        );
        return verdict(
          ...checks,
          ended(grouped, 0),
          is(
            "what the grouped command ran with",
            [{ input: { args: ["1"] }, program: { verbose: true } }],
            withdrawing.seen,
          ),
          ...refusal(refused),
          naming(refused, "--loud"),
          is("runs after --loud", [], stray.seen),
          ended(spec, 0),
          has(spec.out, "flag --verbose global=#true"),
          has(spec.out, "flag --trace global=#true"),
        );
      }),
  },
];

// ---------------------------------------------------------------- the gains of phax's inspection commands

/** Gain (a group's long help and examples): the `debt` group, documented. */
function documentedDebt() {
  const { group, runs } = debt();
  return {
    group: defineGroup({
      name: group.name,
      summary: group.summary,
      help: "A debt is a failing condition accepted for now.\nIt is withdrawn once fixed.",
      examples: ["suite debt accept 1 --why flaky", "suite debt withdraw 1"],
      commands: group.commands,
    }),
    runs,
  };
}

/** Gain (variadic arguments): a rest alone, optional, and a rest after an element of its own
 *  schema, required. */
const FilePath = Schema.String.annotations({ identifier: "path", description: "A file to read" });
const PlanFile = Schema.String.annotations({ identifier: "plan", description: "A plan" });
const files = () => recording("files", { args: reject(Schema.Array(FilePath)) });
const overlap = () => recording("overlap", { args: reject(Schema.NonEmptyArray(PlanFile)) });

/** Gain (a command that prompts): `init` asks a person unless `--yes` is given. */
function prompting(unprompted?: string) {
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "init",
    summary: "configures, asking a person",
    input: { flags: reject(Schema.Struct({ yes: Switch })) },
    output: strip(Str),
    exits: {},
    prompts: (input) => input.flags.yes !== true,
    ...(unprompted === undefined ? {} : { unprompted }),
    run: (context) =>
      Effect.sync(() => {
        seen.push(context.input);
        return "init";
      }),
    render: (text) => text,
  });
  return { command, seen };
}

/** The entry of the command `name` in the catalogue `parsed`, and its input's properties. */
function inputOfEntry(parsed: unknown): {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: unknown;
} {
  const input: unknown = Reflect.get(Object(parsed), "input");
  return {
    properties: Object(Reflect.get(Object(input), "properties")) as Readonly<
      Record<string, unknown>
    >,
    required: Reflect.get(Object(input), "required"),
  };
}

// Gains carried for upstream that phax's inspection commands need (command-contracts plan 2).
// They stand before the library's own gains, whose ids end the table.
const inspectionGainCases: ReadonlyArray<Case> = [
  {
    // Gain: a group's long help and examples. The group's help, on `--help` and when it is
    // called alone, says its summary, its long help, then its examples, before its commands;
    // the usage spec writes them as its `long_help` and its `example` nodes, before its commands.
    id: "groups.long-help",
    check: (runner) =>
      Effect.gen(function* () {
        const shown = documentedDebt();
        const help = yield* call(runner, [shown.group], ["debt", "--help"]);
        const lone = documentedDebt();
        const alone = yield* call(runner, [lone.group], ["debt"]);
        const spec = yield* call(runner, [documentedDebt().group], ["--usage-spec"]);
        const root = yield* call(runner, [documentedDebt().group], ["--help"]);
        const lines = linesOf(spec.out);
        const header = lines.findIndex((each) => each.startsWith("cmd debt "));
        const order = (text: string): Check => {
          const at = [
            "Accept or withdraw a debt",
            "A debt is a failing condition accepted for now.",
            "It is withdrawn once fixed.",
            "Examples:",
            "  suite debt accept 1 --why flaky",
            "  suite debt withdraw 1",
            "Accept a debt",
          ].map((part) => text.indexOf(part));
          return at.every(
            (index, place) => index !== -1 && (place === 0 || index > (at[place - 1] ?? 0)),
          )
            ? undefined
            : `the group's help should say its summary, long help, examples then commands, got ${show(text)}`;
        };
        return verdict(
          ended(help, 0),
          is("err of debt --help", "", help.err),
          order(help.out),
          ...refusal(alone),
          order(alone.err),
          is("runs after the group alone", [], lone.runs),
          ended(root, 0),
          lacks(root.out, "A debt is a failing condition"),
          ended(spec, 0),
          is(
            "the group's header",
            `cmd debt help="Accept or withdraw a debt" long_help="A debt is a failing condition accepted for now.\\nIt is withdrawn once fixed." subcommand_required=#true {`,
            lines[header],
          ),
          is(
            "the group's examples, first in its block",
            [
              `    example "suite debt accept 1 --why flaky"`,
              `    example "suite debt withdraw 1"`,
            ],
            lines.slice(header + 1, header + 3),
          ),
          is(
            "its first command, after its examples",
            true,
            (lines[header + 3] ?? "").startsWith("    cmd accept "),
          ),
        );
      }),
  },
  {
    // Gain: variadic arguments. A tuple's rest takes every operand left: alone it is optional,
    // `[path...]`; after a required element of its own schema it is required, `<plan...>`. Help,
    // the catalogue and the usage spec show it so.
    id: "args.variadic",
    check: (runner) =>
      Effect.gen(function* () {
        const checks: Check[] = [];
        for (const operands of [[], ["a"], ["a", "b", "c"]]) {
          const reading = files();
          const called = yield* call(runner, [reading.command], ["files", ...operands]);
          checks.push(
            ended(called, 0),
            is(`input of files ${operands.join(" ")}`, [{ args: operands }], reading.seen),
          );
        }
        for (const operands of [["a"], ["a", "b"]]) {
          const comparing = overlap();
          const called = yield* call(runner, [comparing.command], ["overlap", ...operands]);
          checks.push(
            ended(called, 0),
            is(`input of overlap ${operands.join(" ")}`, [{ args: operands }], comparing.seen),
          );
        }
        const empty = overlap();
        const none = yield* call(runner, [empty.command], ["overlap"]);
        const both = () => [files().command, overlap().command];
        const filesHelp = yield* call(runner, both(), ["files", "--help"]);
        const overlapHelp = yield* call(runner, both(), ["overlap", "--help"]);
        const filesEntry = yield* printed(runner, both(), ["files", "--json-schema"]);
        const overlapEntry = yield* printed(runner, both(), ["overlap", "--json-schema"]);
        const spec = yield* call(runner, both(), ["--usage-spec"]);
        const optional = inputOfEntry(filesEntry.parsed);
        const needed = inputOfEntry(overlapEntry.parsed);
        return verdict(
          ...checks,
          ...refusal(none),
          naming(none, "plan"),
          ran([empty]),
          ended(filesHelp, 0),
          has(filesHelp.out, "[path...]"),
          has(filesHelp.out, "A file to read"),
          ended(overlapHelp, 0),
          has(overlapHelp.out, "<plan...>"),
          is(
            "files' path property type",
            "array",
            Reflect.get(Object(optional.properties["path"]), "type"),
          ),
          is("files' required", [], optional.required),
          is(
            "overlap's plan property type",
            "array",
            Reflect.get(Object(needed.properties["plan"]), "type"),
          ),
          is(
            "overlap's plan minItems",
            1,
            Reflect.get(Object(needed.properties["plan"]), "minItems"),
          ),
          is("overlap's required", ["plan"], needed.required),
          has(spec.out, `arg "[path]..." help="A file to read"`),
          has(spec.out, `arg "<plan>..." help="A plan"`),
        );
      }),
  },
  {
    // Fix: a negated switch. A Boolean field whose option starts with `no-` (`noProbe`,
    // `--no-probe`) reaches run as true when given and stays absent otherwise; help, the catalogue
    // and the usage spec show `--no-probe`.
    id: "flags.negated-switch",
    check: (runner) =>
      Effect.gen(function* () {
        const negated = () =>
          recording("probe", { flags: reject(Schema.Struct({ noProbe: Switch })) });
        const given = negated();
        const withSwitch = yield* call(runner, [given.command], ["probe", "--no-probe"]);
        const absent = negated();
        const without = yield* call(runner, [absent.command], ["probe"]);
        const help = yield* call(runner, [negated().command], ["probe", "--help"]);
        const entry = yield* printed(runner, [negated().command], ["probe", "--json-schema"]);
        const spec = yield* call(runner, [negated().command], ["--usage-spec"]);
        return verdict(
          ended(withSwitch, 0),
          is("input with --no-probe", [{ flags: { noProbe: true } }], given.seen),
          ended(without, 0),
          is("input without --no-probe", [{ flags: {} }], absent.seen),
          ended(help, 0),
          has(help.out, "--no-probe"),
          is("the entry's options", ["no-probe"], keysOf(inputOfEntry(entry.parsed).properties)),
          has(spec.out, "flag --no-probe"),
        );
      }),
  },
  {
    // Gain: a command that prompts. Under `--json`, a call whose decoded input would make the
    // command ask a person is refused before run, with one `refused` line from the flags; the
    // same call without `--json`, or one that would not prompt, runs.
    id: "json.prompting-refused",
    check: (runner) =>
      Effect.gen(function* () {
        const refused = prompting();
        const json = yield* call(runner, [refused.command], ["init", "--json"]);
        const plain = prompting();
        const text = yield* call(runner, [plain.command], ["init"]);
        const answered = prompting();
        const yes = yield* call(runner, [answered.command], ["init", "--yes", "--json"]);
        return verdict(
          ended(json, REFUSED),
          outEmpty(json),
          is(
            "the refused line",
            [
              {
                kind: "refused",
                source: "flags",
                path: ["json"],
                expected: "a call that does not prompt",
                text: "error: --json: init prompts; run it without --json",
                exit: REFUSED,
              },
            ],
            parsedLines(json.err),
          ),
          is("runs after a refused --json", [], refused.seen),
          ended(text, 0),
          is("runs without --json", 1, plain.seen.length),
          ended(yes, 0),
          is("runs when it does not prompt", [{ flags: { yes: true } }], answered.seen),
        );
      }),
  },
  {
    // Gain: what lifts a prompt. A command that names the flags under which it does not prompt
    // has the `--json` refusal name them, in place of running it without `--json`.
    id: "json.prompting-remedy",
    check: (runner) =>
      Effect.gen(function* () {
        const named = prompting("pass --yes");
        const json = yield* call(runner, [named.command], ["init", "--json"]);
        return verdict(
          ended(json, REFUSED),
          is(
            "the refused line",
            [
              {
                kind: "refused",
                source: "flags",
                path: ["json"],
                expected: "a call that does not prompt",
                text: "error: --json: init prompts; pass --yes",
                exit: REFUSED,
              },
            ],
            parsedLines(json.err),
          ),
          is("runs after a refused --json", [], named.seen),
        );
      }),
  },
];

// ---------------------------------------------------------------- the gains of phax's lifecycle commands

/** Gain (a short alias): `prune`, whose `--yes` is also `-y`. */
const Yes = Schema.optionalKey(Schema.Boolean).annotations({
  description: "Proceed without asking",
  [AliasAnnotationId]: "y",
});
const pruning = () => recording("prune", { flags: reject(Schema.Struct({ yes: Yes })) });

/** Gain (the document as read): what run received beside its input. */
function asRead(name: string, input: Inputs) {
  const seen: unknown[] = [];
  const command = defineCommand({
    name,
    summary: `the ${name} command`,
    input,
    output: strip(Str),
    exits: {},
    run: (context) =>
      Effect.sync(() => {
        seen.push(context.document);
        return name;
      }),
    render: (text) => text,
  });
  return { command, seen };
}

/** Gain (a document's check): `decide`, whose check refuses a todo named `bad`, and dies on one
 *  named `boom`. What each check and each run received is kept. */
function checking() {
  const checked: unknown[] = [];
  const seen: unknown[] = [];
  const command = defineCommand({
    name: "decide",
    summary: "decides the todos of a document",
    input: { stdin: reject(Doc, { flag: "verdicts", valueRequired: true }) },
    output: strip(Str),
    exits: {},
    check: (context) =>
      Effect.suspend(() => {
        checked.push({ input: context.input, document: context.document });
        const todos = context.input.stdin?.todos ?? [];
        if (todos.includes("boom")) return Effect.die(new Error("the check broke"));
        const at = todos.indexOf("bad");
        return at === -1
          ? Effect.void
          : Effect.fail(
              new Refused({
                source: "stdin",
                path: ["todos", String(at)],
                expected: "a known todo",
                text: `error: todos[${at}] is not a known todo`,
              }),
            );
      }),
    run: (context) =>
      Effect.sync(() => {
        seen.push(context.input);
        return "decided";
      }),
    render: (text) => text,
  });
  return { command, checked, seen };
}

/** Gain (a group's retired words): `artifact`, holding `status` and retiring `archive`, and a
 *  group `outer` holding a group `inner` that retires `obsolete`. */
const ARCHIVE_SENTENCE = `unknown transition "archive" — the completion transition is: suite artifact complete <path>`;
const OLD_SENTENCE = "suite outer inner obsolete is retired: use suite outer inner leaf";
function retiring() {
  const status = recording("status", {});
  const leaf = recording("leaf", {});
  const artifact = defineGroup({
    name: "artifact",
    summary: "Artifacts",
    retired: { archive: ARCHIVE_SENTENCE },
    commands: [status.command],
  });
  const outer = defineGroup({
    name: "outer",
    summary: "The outer group",
    commands: [
      defineGroup({
        name: "inner",
        summary: "The inner group",
        retired: { obsolete: OLD_SENTENCE },
        commands: [leaf.command],
      }),
    ],
  });
  return { groups: [artifact, outer], status, leaf };
}

// Gains carried for upstream that phax's lifecycle and authoring commands need (command-contracts
// plan 3). They stand before the inspection commands' gains.
const lifecycleGainCases: ReadonlyArray<Case> = [
  {
    // Gain: a short alias. An option's field declares one letter; the option decodes alike from
    // `-y` and `--yes`, help shows `-y, --yes`, the catalogue's property says `x-alias: "-y"`,
    // the usage spec writes `flag "--yes -y"`. An alias two options share, or `-h`, stops the
    // program.
    id: "flags.short-alias",
    check: (runner) =>
      Effect.gen(function* () {
        const short = pruning();
        const byShort = yield* call(runner, [short.command], ["prune", "-y"]);
        const long = pruning();
        const byLong = yield* call(runner, [long.command], ["prune", "--yes"]);
        const unknown = pruning();
        const other = yield* call(runner, [unknown.command], ["prune", "-z"]);
        const help = yield* call(runner, [pruning().command], ["prune", "--help"]);
        const entry = yield* printed(runner, [pruning().command], ["prune", "--json-schema"]);
        const spec = yield* call(runner, [pruning().command], ["--usage-spec"]);
        const ok = recording("ok", {});
        const twice = recording("twice", {
          flags: reject(Schema.Struct({ yes: Yes, yolo: Yes })),
        });
        const shared = yield* call(runner, [ok.command, twice.command], ["ok"]);
        const helpless = recording("helpless", {
          flags: reject(
            Schema.Struct({
              hard: Schema.optionalKey(Schema.Boolean).annotations({
                [AliasAnnotationId]: "h",
              }),
            }),
          ),
        });
        const help2 = recording("ok", {});
        const onHelp = yield* call(runner, [help2.command, helpless.command], ["ok"]);
        return verdict(
          ended(byShort, 0),
          is("input of -y", [{ flags: { yes: true } }], short.seen),
          ended(byLong, 0),
          is("input of --yes", [{ flags: { yes: true } }], long.seen),
          ...refusal(other),
          naming(other, "-z"),
          ran([unknown]),
          ended(help, 0),
          has(help.out, "-y, --yes"),
          is(
            "the entry's alias",
            "-y",
            Reflect.get(Object(inputOfEntry(entry.parsed).properties["yes"]), "x-alias"),
          ),
          has(spec.out, `flag "--yes -y" help="Proceed without asking"`),
          ...defect(shared),
          naming(shared, "twice"),
          ran([ok, twice]),
          ...defect(onHelp),
          naming(onHelp, "helpless"),
          ran([help2, helpless]),
        );
      }),
  },
  {
    // Gain: stdout progress. A `say` line reaches `out` at once while run runs, before the
    // render; under `--json` it is a `note` line on `err`, and `out` holds the output alone.
    id: "progress.say-on-stdout",
    check: (runner) =>
      Effect.gen(function* () {
        const saying = (seenAtStep: string[], out: () => string) =>
          defineCommand({
            name: "author",
            summary: "says what it does, then answers",
            input: {},
            output: strip(Item),
            exits: {},
            run: ({ say }) =>
              Effect.gen(function* () {
                yield* say("authoring spec garden");
                seenAtStep.push(out());
                yield* say("");
                return { id: "t1", name: "one", $schema: ITEM_FORMAT };
              }),
            render: (item) => `wrote ${item.name}`,
          });
        const run = (argv: ReadonlyArray<string>) =>
          Effect.gen(function* () {
            const memory = memoryIo({ argv });
            const seenAtStep: string[] = [];
            const code = yield* runner.run(program(saying(seenAtStep, memory.out)), memory.io);
            return { code, seenAtStep, writes: memory.writes() };
          });
        const text = yield* run(["author"]);
        const json = yield* run(["author", "--json"]);
        const encoded = `${JSON.stringify({ $schema: ITEM_FORMAT, id: "t1", name: "one" }, null, 2)}\n`;
        return verdict(
          is("exit code without --json", 0, text.code),
          is(
            "out written by the say, without --json",
            ["authoring spec garden\n"],
            text.seenAtStep,
          ),
          is(
            "the writes without --json, in order",
            [
              { stream: "out", text: "authoring spec garden\n" },
              { stream: "out", text: "wrote one\n" },
            ],
            text.writes,
          ),
          is("exit code with --json", 0, json.code),
          is("out written by the say, with --json", [""], json.seenAtStep),
          is(
            "the writes with --json, in order",
            [
              { stream: "err", text: `{"kind":"note","text":"authoring spec garden"}\n` },
              { stream: "out", text: encoded },
            ],
            json.writes,
          ),
        );
      }),
  },
  {
    // Gain: the document as read. Run is handed the stdin document as the runner read it: its
    // origin, stdin or the path as the call wrote it, and its text before decoding, JSON or text;
    // nothing when no document was read.
    id: "stdin.document-as-read",
    check: (runner) =>
      Effect.gen(function* () {
        const verdicts = () =>
          asRead("decide", {
            stdin: reject(Doc, { flag: "verdicts", valueRequired: true }),
          });
        const spaced = `{ "todos": ["a"] }\n`;
        const byFile = verdicts();
        const file = yield* call(runner, [byFile.command], ["decide", "--verdicts", "./in.json"], {
          files: { "./in.json": spaced },
        });
        const byDash = verdicts();
        const dash = yield* call(runner, [byDash.command], ["decide", "--verdicts", "-"], {
          stdin: spaced,
        });
        const absent = verdicts();
        const none = yield* call(runner, [absent.command], ["decide"]);
        const briefed = asRead("brief", {
          stdin: reject(Schema.String, { flag: "brief", text: true }),
        });
        const brief = yield* call(runner, [briefed.command], ["brief", "--brief=brief.md"], {
          files: { "brief.md": BRIEF },
        });
        const piped = asRead("piped", { stdin: strip(Schema.String, { text: true }) });
        const pipedCall = yield* call(runner, [piped.command], ["piped"], { stdin: BRIEF });
        return verdict(
          ended(file, 0),
          is(
            "the document of --verdicts <path>",
            [{ origin: { kind: "file", path: "./in.json" }, text: spaced }],
            byFile.seen,
          ),
          ended(dash, 0),
          is(
            "the document of --verdicts -",
            [{ origin: { kind: "stdin" }, text: spaced }],
            byDash.seen,
          ),
          ended(none, 0),
          is("the document of a call without --verdicts", [undefined], absent.seen),
          ended(brief, 0),
          is(
            "the document of --brief=<path>",
            [{ origin: { kind: "file", path: "brief.md" }, text: BRIEF }],
            briefed.seen,
          ),
          ended(pipedCall, 0),
          is("the document piped in", [{ origin: { kind: "stdin" }, text: BRIEF }], piped.seen),
        );
      }),
  },
  {
    // Gain: a document's check. The check runs after the decode and before run, handed the
    // decoded input and the document as read. Its `Refused` is one `refused` line under `--json`
    // and its text without, the call ending with the `refused` code and running nothing; a check
    // that holds runs run; a check that dies is a defect.
    id: "stdin.check-refused",
    check: (runner) =>
      Effect.gen(function* () {
        const bad = JSON.stringify({ todos: ["a", "bad"] });
        const refusedJson = checking();
        const json = yield* call(
          runner,
          [refusedJson.command],
          ["decide", "--verdicts", "in.json", "--json"],
          { files: { "in.json": bad } },
        );
        const refusedText = checking();
        const text = yield* call(runner, [refusedText.command], ["decide", "--verdicts", "-"], {
          stdin: bad,
        });
        const passing = checking();
        const passed = yield* call(runner, [passing.command], ["decide", "--verdicts", "-"], {
          stdin: DOC_JSON,
        });
        const dying = checking();
        const died = yield* call(runner, [dying.command], ["decide", "--verdicts", "-"], {
          stdin: JSON.stringify({ todos: ["boom"] }),
        });
        return verdict(
          ended(json, REFUSED),
          outEmpty(json),
          is(
            "the refused line",
            [
              {
                kind: "refused",
                source: "stdin",
                path: ["todos", "1"],
                expected: "a known todo",
                text: "error: todos[1] is not a known todo",
                exit: REFUSED,
              },
            ],
            parsedLines(json.err),
          ),
          is(
            "what the check received",
            [
              {
                input: { stdin: { todos: ["a", "bad"] } },
                document: { origin: { kind: "file", path: "in.json" }, text: bad },
              },
            ],
            refusedJson.checked,
          ),
          is("runs after a refused --json", [], refusedJson.seen),
          ...refusal(text),
          is("err without --json", "error: todos[1] is not a known todo\n", text.err),
          is("runs after a refusal", [], refusedText.seen),
          ended(passed, 0),
          is("runs after a check that holds", [{ stdin: DOC_VALUE }], passing.seen),
          has(passed.out, "decided"),
          ...defect(died),
          is("runs after a check that dies", [], dying.seen),
        );
      }),
  },
  {
    // Gain: a group's retired words. A call naming a group then a word it retired, at any depth,
    // is refused with the word's sentence; under `--json`, one `refused` line from the command.
    // A retired word is never in help, the catalogue, a suggestion or the usage spec; a group
    // retiring a word it holds stops the program.
    id: "groups.retired-word",
    check: (runner) =>
      Effect.gen(function* () {
        const first = retiring();
        const text = yield* call(runner, first.groups, ["artifact", "archive", "plan.md"]);
        const second = retiring();
        const json = yield* call(runner, second.groups, ["artifact", "archive", "--json"]);
        const third = retiring();
        const deep = yield* call(runner, third.groups, ["outer", "inner", "obsolete"]);
        const help = yield* call(runner, retiring().groups, ["artifact", "--help"]);
        const alone = yield* call(runner, retiring().groups, ["artifact"]);
        const near = yield* call(runner, retiring().groups, ["artifact", "archiv"]);
        const catalogued = yield* call(runner, retiring().groups, ["--json-schema"]);
        const spec = yield* call(runner, retiring().groups, ["--usage-spec"]);
        const ok = recording("ok", {});
        const status = recording("status", {});
        const clashing = defineGroup({
          name: "artifact",
          summary: "Artifacts",
          retired: { status: "status is retired" },
          commands: [status.command],
        });
        const clash = yield* call(runner, [ok.command, clashing], ["ok"]);
        return verdict(
          ...refusal(text),
          is("err of a retired word", `${ARCHIVE_SENTENCE}\n`, text.err),
          ran([first.status, first.leaf]),
          ended(json, REFUSED),
          outEmpty(json),
          is(
            "the refused line",
            [
              {
                kind: "refused",
                source: "command",
                path: ["artifact", "archive"],
                expected: "a command of artifact",
                text: ARCHIVE_SENTENCE,
                exit: REFUSED,
              },
            ],
            parsedLines(json.err),
          ),
          ...refusal(deep),
          is("err of a retired word at depth two", `${OLD_SENTENCE}\n`, deep.err),
          ran([third.status, third.leaf]),
          ended(help, 0),
          lacks(help.out, "archive"),
          lacks(alone.err, "archive"),
          ...refusal(near),
          lacks(near.err, "archive"),
          ended(catalogued, 0),
          lacks(catalogued.out, "archive"),
          lacks(catalogued.out, "obsolete"),
          ended(spec, 0),
          lacks(spec.out, "archive"),
          lacks(spec.out, "obsolete"),
          ...defect(clash),
          naming(clash, "artifact"),
          naming(clash, "status"),
          ran([ok, status]),
        );
      }),
  },
];

// ---------------------------------------------------------------- the gains of phax's run and session commands

/** Gain (an option with an optional value): `run`, whose `--hold` is bare or takes a selection. */
const Hold = Schema.optionalKey(Schema.Union(Schema.Literal(true), Schema.String)).annotations({
  identifier: "selection",
  description: "Hold the run at a phase",
  [OptionalValueAnnotationId]: true,
});
const holding = () =>
  recording("run", {
    args: reject(Schema.Tuple(Schema.optionalElement(Str))),
    flags: reject(Schema.Struct({ hold: Hold })),
  });

/** Gain (a command's retired options): `resume`, which retired `--skip-check`. */
const SKIP_CHECK_SENTENCE = "--skip-check is no longer read: write --skip-review";
const resuming = () => {
  const recorded = recording("resume", {
    args: reject(Schema.Tuple(Str)),
    flags: reject(Schema.Struct({ skipAcceptance: Switch })),
  });
  return {
    ...recorded,
    command: { ...recorded.command, retiredOptions: { "skip-check": SKIP_CHECK_SENTENCE } },
  };
};

/** Gain (an empty render): `quiet`, whose render answers nothing and whose notes say a line. */
const quiet = () =>
  defineCommand({
    name: "quiet",
    summary: "answers nothing on stdout",
    input: {},
    output: strip(Schema.Struct({ said: Str })),
    exits: {},
    run: () => Effect.succeed({ said: "a note" }),
    render: () => "",
    notes: (value) => value.said,
  });

/** Gain (a handed-over exit): `enter`, which hands the terminal to a process exiting `code`. */
const entering = (code: ExitCode) =>
  defineCommand({
    name: "enter",
    summary: "hands the terminal over",
    input: {},
    output: strip(Schema.Struct({ exit: Schema.Number })),
    exits: {},
    prompts: () => true,
    run: () => Effect.succeed({ exit: code }),
    render: (value) => `exited ${value.exit}`,
    handsOver: (value) => value.exit,
  });

// Gains carried for upstream that phax's run and session commands need (command-contracts
// plan 4). They stand before the lifecycle commands' gains.
const runSessionGainCases: ReadonlyArray<Case> = [
  {
    // Gain: an option with an optional value. Bare, it decodes to true; spaced or attached, to its
    // value; absent, to nothing. Help shows `--hold [selection]`, the catalogue the union, and the
    // usage spec `flag "--hold [selection]"`.
    id: "flags.optional-value",
    check: (runner) =>
      Effect.gen(function* () {
        const bareHold = holding();
        const byBare = yield* call(runner, [bareHold.command], ["run", "--hold"]);
        const spaced = holding();
        const bySpace = yield* call(runner, [spaced.command], ["run", "--hold", "phase-02"]);
        const attached = holding();
        const byEquals = yield* call(runner, [attached.command], ["run", "--hold=phase-02"]);
        const absent = holding();
        const without = yield* call(runner, [absent.command], ["run", "x"]);
        const before = holding();
        const named = yield* call(runner, [before.command], ["run", "--hold", "--json"]);
        const help = yield* call(runner, [holding().command], ["run", "--help"]);
        const entry = yield* printed(runner, [holding().command], ["run", "--json-schema"]);
        const spec = yield* call(runner, [holding().command], ["--usage-spec"]);
        const property: unknown = inputOfEntry(entry.parsed).properties["hold"];
        return verdict(
          ended(byBare, 0),
          is("input of a bare --hold", [{ args: [], flags: { hold: true } }], bareHold.seen),
          ended(bySpace, 0),
          is("input of --hold phase-02", [{ args: [], flags: { hold: "phase-02" } }], spaced.seen),
          ended(byEquals, 0),
          is(
            "input of --hold=phase-02",
            [{ args: [], flags: { hold: "phase-02" } }],
            attached.seen,
          ),
          ended(without, 0),
          is("input without --hold", [{ args: ["x"], flags: {} }], absent.seen),
          ended(named, 0),
          is("input of --hold before --json", [{ args: [], flags: { hold: true } }], before.seen),
          ended(help, 0),
          has(help.out, "--hold [selection]"),
          has(JSON.stringify(property), "true"),
          has(JSON.stringify(property), '"string"'),
          has(spec.out, `flag "--hold [selection]" help="Hold the run at a phase"`),
        );
      }),
  },
  {
    // Gain: a command's retired options. A call giving a retired option is refused with its own
    // sentence, then the refusal hint; under `--json`, one `refused` line from the flags. It is
    // never in help, the catalogue, a suggestion or the usage spec; a command retiring an option
    // it declares stops the program.
    id: "flags.retired-option",
    check: (runner) =>
      Effect.gen(function* () {
        const first = resuming();
        const text = yield* call(runner, [first.command], ["resume", "x", "--skip-check"]);
        const second = resuming();
        const json = yield* call(
          runner,
          [second.command],
          ["resume", "x", "--skip-check=true", "--json"],
        );
        const help = yield* call(runner, [resuming().command], ["resume", "--help"]);
        const near = yield* call(runner, [resuming().command], ["resume", "x", "--skip-chec"]);
        const entry = yield* printed(runner, [resuming().command], ["resume", "--json-schema"]);
        const spec = yield* call(runner, [resuming().command], ["--usage-spec"]);
        const ok = recording("ok", {});
        const base = recording("resume", {
          args: reject(Schema.Tuple(Str)),
          flags: reject(Schema.Struct({ skipCheck: Switch })),
        });
        const clashing = { ...base.command, retiredOptions: { "skip-check": "retired" } };
        const clash = yield* call(runner, [ok.command, clashing], ["ok"]);
        return verdict(
          ...refusal(text),
          is("err of a retired option", `${SKIP_CHECK_SENTENCE}\n`, text.err),
          ran([first]),
          ended(json, REFUSED),
          outEmpty(json),
          is(
            "the refused line",
            [
              {
                kind: "refused",
                source: "flags",
                path: ["skip-check"],
                expected: "no such option",
                text: SKIP_CHECK_SENTENCE,
                exit: REFUSED,
              },
            ],
            parsedLines(json.err),
          ),
          ran([second]),
          ended(help, 0),
          lacks(help.out, "skip-check"),
          ...refusal(near),
          lacks(near.err, "skip-check"),
          ended(entry.called, 0),
          lacks(entry.called.out, "skip-check"),
          ended(spec, 0),
          lacks(spec.out, "skip-check"),
          ...defect(clash),
          naming(clash, "resume"),
          ran([ok, base]),
        );
      }),
  },
  {
    // Gain: an empty render. A render answering the empty text writes nothing on `out`, not even
    // a newline, while its notes still reach `err`; under `--json` the encoded output is written.
    id: "output.empty-render",
    check: (runner) =>
      Effect.gen(function* () {
        const text = yield* call(runner, [quiet()], ["quiet"]);
        const json = yield* call(runner, [quiet()], ["quiet", "--json"]);
        return verdict(
          ended(text, 0),
          outEmpty(text),
          is("err of the notes", "a note\n", text.err),
          ended(json, 0),
          is("out under --json", `${JSON.stringify({ said: "a note" }, null, 2)}\n`, json.out),
          is(
            "the note line",
            [{ kind: "note", text: "a note" }],
            parsedLines(json.err).map((each) => ({
              kind: Reflect.get(Object(each), "kind"),
              text: Reflect.get(Object(each), "text"),
            })),
          ),
        );
      }),
  },
  {
    // Gain: a handed-over exit. Without `--json`, a command handing the terminal over exits the
    // code its process answered, whatever it is, the program's `refused` and `defect` codes
    // included, after its render; under `--json` it is refused, as it prompts. A command handing
    // the terminal over that declares no prompts stops the program; the catalogue says
    // `handsOver: true`.
    id: "exits.handed-over",
    check: (runner) =>
      Effect.gen(function* () {
        // 64 is the program's `refused` code; 70, a code many programs choose for a defect.
        const codes: ReadonlyArray<ExitCode> = [0, 1, REFUSED, 70];
        const checks: Check[] = [];
        for (const code of codes) {
          const called = yield* call(runner, [entering(code)], ["enter"]);
          checks.push(
            ended(called, code),
            is(`out of a process exiting ${code}`, `exited ${code}\n`, called.out),
          );
        }
        const json = yield* call(runner, [entering(70)], ["enter", "--json"]);
        const entry = yield* printed(runner, [entering(0)], ["enter", "--json-schema"]);
        const ok = recording("ok", {});
        const { prompts: _prompts, ...unprompted } = entering(0);
        const stopped = yield* call(runner, [ok.command, unprompted], ["ok"]);
        return verdict(
          ...checks,
          ...refusal(json),
          is("handsOver in the entry", true, Reflect.get(Object(entry.parsed), "handsOver")),
          ...defect(stopped),
          naming(stopped, "enter"),
          ran([ok]),
        );
      }),
  },
];

// ---------------------------------------------------------------- the gains of a whole program

/** Gain (a whole program): the suite's program with what a program says of itself. */
const programOf = (
  extra: {
    readonly summary?: string;
    readonly license?: string;
    readonly versionAlias?: string;
    readonly helpCommand?: true;
    readonly guard?: NonNullable<Program<never>["guard"]>;
    readonly usage?: ProgramUsage;
    readonly options?: NonNullable<Program<never>["options"]>;
  },
  ...commands: ReadonlyArray<Command<never> | Group<never>>
) =>
  defineProgram({
    name: "suite",
    version: "9.9.9",
    exits: { refused: REFUSED, defect: DEFECT },
    commands,
    ...extra,
  });

/** Gain (the program's guard): the code it refuses with, not the program's `refused`. */
const GUARDED = 1;
const GUARD_SENTENCE = "suite run is not allowed here";

/** Gain (the program's guard): a guard refusing `run`, and each call it was asked about. */
function guarding() {
  const asked: unknown[] = [];
  const guard: NonNullable<Program<never>["guard"]> = (called) => {
    asked.push(called);
    return called.words.join(" ") === "run" ? { text: GUARD_SENTENCE, exit: GUARDED } : undefined;
  };
  return { guard, asked };
}

const guardedRun = () =>
  recording("run", {
    args: reject(Schema.Tuple(Str)),
    flags: reject(Schema.Struct({ dryRun: Switch })),
  });

const Verbose = Schema.optionalKey(Schema.Boolean).annotations({
  description: "Say more",
});

/** Gain (root help): the usage flags with their own help and default. */
const SUITE_USAGE: ProgramUsage = {
  flag: "usage",
  format: "usage-format",
  jsonSchema: "program",
  help: "Print the usage spec",
  formatHelp: "The usage spec's format",
  formatDefault: "kdl",
};

/** Gain (root help): the suite's whole program, as root help writes it. */
const helped = () =>
  programOf(
    {
      summary: "A suite of commands",
      versionAlias: "V",
      helpCommand: true,
      usage: SUITE_USAGE,
      options: reject(Schema.Struct({ verbose: Verbose })),
    },
    pair().command,
    debt().group,
    bare().command,
  );

/** A row of root help as Commander writes it at 80 columns: two spaces, the term padded to the
 *  widest term (`pair [options] <arg0> <arg1>`, 28), two spaces, the text. */
const row = (term: string, text: string): string => `  ${term.padEnd(28)}  ${text}`;

/** Gain (root help): the suite's root help, written as Commander writes a program's; the
 *  `--json-schema` text wraps at 80 columns under its own column. */
const SUITE_ROOT_HELP = [
  "Usage: suite [options] [command]",
  "",
  "A suite of commands",
  "",
  "Options:",
  row("-V, --version", "output the version number"),
  row("--verbose", "Say more"),
  row("--usage", "Print the usage spec"),
  row("--usage-format <format>", `The usage spec's format (default: "kdl")`),
  row("--json-schema", "Print the program's contracts as JSON Schema,"),
  row("", "or a command's after its name, and run nothing"),
  row("-h, --help", "display help for command"),
  "",
  "Commands:",
  row("pair [options] <arg0> <arg1>", "the pair command"),
  row("debt", "Accept or withdraw a debt"),
  row("bare [options]", "the bare command"),
  row("help [command]", "display help for command"),
  "",
].join("\n");

// Gains carried for upstream that a whole program needs to run without a host parser
// (command-contracts plan 4, phase-08): a guard, root help, the version's short form, a help
// command, the usage header and plain groups.
const programGainCases: ReadonlyArray<Case> = [
  {
    // Gain: the program's guard. Asked on the located command before anything is decoded, with
    // the command's words and the options the call gives; its refusal is its text and its own
    // code without `--json`, one `refused` line with it. Never asked for `--help`, `-h` or
    // `--json-schema`; a call it lets through runs.
    id: "program.guard",
    check: (runner) =>
      Effect.gen(function* () {
        const checks: Check[] = [];
        const text = guarding();
        const refusedRun = guardedRun();
        const plain = yield* callProgram(
          runner,
          programOf({ guard: text.guard, options: ProgramOptions }, refusedRun.command),
          ["--verbose", "run", "x", "--dry-run", "--loud"],
        );
        checks.push(
          ended(plain, GUARDED),
          outEmpty(plain),
          is("err of the guard", `${GUARD_SENTENCE}\n`, plain.err),
          is(
            "what the guard was asked",
            [{ words: ["run"], options: { verbose: true, dryRun: true, loud: true } }],
            text.asked,
          ),
          ran([refusedRun]),
        );
        const json = guarding();
        const jsonRun = guardedRun();
        const lined = yield* callProgram(
          runner,
          programOf({ guard: json.guard }, jsonRun.command),
          ["run", "x", "--json"],
        );
        checks.push(
          ended(lined, GUARDED),
          outEmpty(lined),
          is(
            "the refused line",
            [
              {
                kind: "refused",
                source: "command",
                path: ["run"],
                expected: "a command the program's guard allows",
                text: GUARD_SENTENCE,
                exit: GUARDED,
              },
            ],
            parsedLines(lined.err),
          ),
          ran([jsonRun]),
        );
        for (const argv of [
          ["run", "--help"],
          ["run", "-h"],
          ["run", "--json-schema"],
        ]) {
          const skipped = guarding();
          const called = yield* callProgram(
            runner,
            programOf({ guard: skipped.guard }, guardedRun().command),
            argv,
          );
          checks.push(
            ended(called, 0),
            is(`what the guard was asked for ${argv.join(" ")}`, [], skipped.asked),
          );
        }
        const allowed = guarding();
        const paired = pair();
        const through = yield* callProgram(
          runner,
          programOf({ guard: allowed.guard }, paired.command, guardedRun().command),
          ["pair", "a", "b"],
        );
        checks.push(
          ended(through, 0),
          is(
            "what the guard was asked for pair",
            [{ words: ["pair"], options: {} }],
            allowed.asked,
          ),
          is("what pair ran with", [{ args: ["a", "b"] }], paired.seen),
        );
        return verdict(...checks);
      }),
  },
  {
    // Gain: root help. The program's summary under the usage line; the version as `-V,
    // --version`; the program's options, then the usage flag and its format with their help and
    // the format's default, then `--json-schema`; the commands in program order with Commander's
    // terms, then `help [command]`. `-V` alone prints the version.
    id: "program.root-help",
    check: (runner) =>
      Effect.gen(function* () {
        const terminal: Terminal = { columns: 80, color: false };
        const help = yield* callProgram(runner, helped(), ["--help"], { terminal });
        const short = yield* callProgram(runner, helped(), ["-h"], { terminal });
        const version = yield* callProgram(runner, helped(), ["-V"]);
        const long = yield* callProgram(runner, helped(), ["--version"]);
        const inside = yield* callProgram(runner, helped(), ["bare", "-V"]);
        return verdict(
          ended(help, 0),
          is("root help", SUITE_ROOT_HELP, help.out),
          is("err of root help", "", help.err),
          ended(short, 0),
          is("root help on -h", SUITE_ROOT_HELP, short.out),
          ended(version, 0),
          is("out of -V", "9.9.9\n", version.out),
          ended(long, 0),
          is("out of --version", "9.9.9\n", long.out),
          ...refusal(inside),
        );
      }),
  },
  {
    // Gain: the root's help command. `help <words>` answers that command's or group's help as
    // `<words> --help` does, `help` alone the root's; a word that names none is refused as an
    // unknown command. Without the gain, the word `help` is refused, as the library has it.
    id: "program.help-command",
    check: (runner) =>
      Effect.gen(function* () {
        const checks: Check[] = [];
        const pairs: ReadonlyArray<readonly [ReadonlyArray<string>, ReadonlyArray<string>]> = [
          [
            ["help", "pair"],
            ["pair", "--help"],
          ],
          [
            ["help", "debt"],
            ["debt", "--help"],
          ],
          [
            ["help", "debt", "accept"],
            ["debt", "accept", "--help"],
          ],
          [["help"], ["--help"]],
        ];
        for (const [asked, flagged] of pairs) {
          const byWord = yield* callProgram(runner, helped(), asked);
          const byFlag = yield* callProgram(runner, helped(), flagged);
          checks.push(
            ended(byWord, 0),
            byWord.out === "" ? `${asked.join(" ")} should write help` : undefined,
            is(`${asked.join(" ")} against ${flagged.join(" ")}`, byFlag.out, byWord.out),
          );
        }
        const unknown = yield* callProgram(runner, helped(), ["help", "nope"]);
        const library = yield* callProgram(runner, program(bare().command), ["help", "bare"]);
        return verdict(
          ...checks,
          ...refusal(unknown),
          naming(unknown, "nope"),
          ...refusal(library),
          naming(library, "help"),
        );
      }),
  },
  {
    // Gain: the usage header. The program's licence, its minimum usage version and its summary
    // are written after its version, in that order, before anything else; the usage flags with
    // their own help and default. A program declaring none writes none of them.
    id: "usage.root-header",
    check: (runner) =>
      Effect.gen(function* () {
        const declared = yield* callProgram(
          runner,
          programOf(
            {
              summary: "A suite of commands",
              license: "Apache-2.0",
              usage: { ...SUITE_USAGE, minUsageVersion: "1.0.0" },
            },
            bare().command,
          ),
          ["--usage"],
        );
        const library = yield* callProgram(runner, program(bare().command), ["--usage-spec"]);
        const head = linesOf(declared.out).slice(0, 7);
        return verdict(
          ended(declared, 0),
          is(
            "the root's header",
            [
              "name suite",
              "bin suite",
              'version "9.9.9"',
              'license "Apache-2.0"',
              'min_usage_version "1.0.0"',
              'about "A suite of commands"',
            ],
            head.slice(0, 6),
          ),
          has(head[6] ?? "", "after_long_help "),
          has(declared.out, 'flag --usage help="Print the usage spec"\n'),
          has(
            declared.out,
            `flag "--usage-format <format>" help="The usage spec's format" default="kdl"\n`,
          ),
          ended(library, 0),
          ...["license ", "min_usage_version ", "about "].map((node) =>
            linesOf(library.out).some((each) => each.startsWith(node))
              ? `a program declaring none should write no ${node.trim()}`
              : undefined,
          ),
        );
      }),
  },
  {
    // Gain: plain groups. With `groups: "plain"` a group's `cmd` line carries no
    // `subcommand_required`; without it, as the library writes it. Either way the runner refuses
    // a group called alone.
    id: "usage.plain-groups",
    check: (runner) =>
      Effect.gen(function* () {
        const plain = () => programOf({ usage: { flag: "usage", groups: "plain" } }, debt().group);
        const spec = yield* callProgram(runner, plain(), ["--usage"]);
        const byDefault = yield* callProgram(
          runner,
          programOf({ usage: { flag: "usage" } }, debt().group),
          ["--usage"],
        );
        const alone = yield* callProgram(runner, plain(), ["debt"]);
        return verdict(
          ended(spec, 0),
          has(spec.out, 'cmd debt help="Accept or withdraw a debt" {\n'),
          lacks(spec.out, "subcommand_required"),
          ended(byDefault, 0),
          has(
            byDefault.out,
            'cmd debt help="Accept or withdraw a debt" subcommand_required=#true {',
          ),
          ...refusal(alone),
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
        const first = yield* call(runner, [moved.command], ["move", "--to", "one", "--", "-x"]);
        const paired = pair();
        const second = yield* call(runner, [paired.command], ["pair", "--", "--", "-x"]);
        return verdict(
          ended(first, 0),
          ended(second, 0),
          is("input run received", [{ args: ["-x"], flags: { to: "one" } }], moved.seen),
          is("input run received", [{ args: ["--", "-x"] }], paired.seen),
        );
      }),
  },
  refuses("args.reject.surplus-after-double-dash", oneReject, ["one", "--", "a", "-b"], {
    names: "-b",
  }),
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
        const given = yield* call(runner, [good.command], ["count", "--count", "3"]);
        const bad = count();
        const refused = yield* call(runner, [bad.command], ["count", "--count", "x"]);
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
        return verdict(ended(called, 0), is("stdin evaluations", 0, called.reads));
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
        const calls: ReadonlyArray<readonly [ReadonlyArray<string>, string?]> = [
          [["opts", "--to", "one", "--force"]],
          [["one", "a", "b"]],
          [["one"]],
          [["count", "--count", "x"]],
          [["in-reject"], "not json"],
        ];
        const problems: Check[] = [];
        for (const [argv, stdin] of calls) {
          const called = yield* call(runner, commands, argv, stdin === undefined ? {} : { stdin });
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
        return verdict(ended(called, MAPPED), outEmpty(called), errWritten(called));
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
          called.code === 0 ? "exit code should not be 0, the program is refused" : undefined,
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
          const called = yield* call(runner, [kind.command, finding("find")], [kind.command.name]);
          problems.push(is(`exit code of ${kind.label}`, DEFECT, called.code));
        }
        const { ok, bad } = collidingCommands();
        const colliding = yield* call(runner, [ok.command, bad], ["ok"]);
        problems.push(is("exit code of command-maps-defect-code", DEFECT, colliding.code));
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
                problems.push(`${flag}: out should name ${show(word)}, got ${show(called.out)}`);
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
        const called = yield* call(runner, [recorded.command], ["opts", "--help"]);
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
          run: () => Effect.succeed({ id: "t1", count: 3, $schema: SCHEMA, extra: 1 }),
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
        const flag = yield* call(runner, [recorded.command], ["bound", "--request"], {
          stdin: DOC_JSON,
        });
        const dash = yield* call(runner, [recorded.command], ["bound", "--request", "-"], {
          stdin: DOC_JSON,
        });
        const equals = yield* call(runner, [recorded.command], ["bound", "--request=-"], {
          stdin: DOC_JSON,
        });
        const file = yield* call(runner, [recorded.command], ["bound", "--request=in.json"], {
          stdin: '{"todos":["not this"]}',
          files: { "in.json": DOC_JSON },
        });
        const input = { stdin: DOC_VALUE };
        return verdict(
          ended(flag, 0),
          ended(dash, 0),
          ended(equals, 0),
          ended(file, 0),
          is("inputs run received", [input, input, input, input], recorded.seen),
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
        const second = yield* call(runner, [flagged.command], ["bound", "--request"], {
          stdin: DOC_JSON,
          stdinIsTerminal: true,
        });
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
        const extra = yield* call(runner, [recorded.command], ["bound", "--request", "-"], {
          stdin: JSON.stringify({ todos: [], extra: 1 }),
        });
        const notJson = yield* call(runner, [recorded.command], ["bound", "--request", "-"], {
          stdin: "not json",
        });
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
          run: () => written(WRITTEN_FIXTURE.path, utf8Bytes(WRITTEN_FIXTURE.bytes)),
        });
        const called = yield* call(runner, [make], ["make"]);
        return verdict(
          ended(called, 0),
          is("out", `${JSON.stringify(WRITTEN_FIXTURE.record, null, 2)}\n`, called.out),
        );
      }),
  },
  ...jsonCases,
  ...groupCases,
  ...programGainCases,
  ...runSessionGainCases,
  ...lifecycleGainCases,
  ...inspectionGainCases,
  ...gainCases,
];
