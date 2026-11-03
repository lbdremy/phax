// processIo against a fake process object: its stdin is an in-memory stream, never the real one,
// and its files live in a temporary folder.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { processIo, runner } from "../../../../src/cli/commandLibrary/commander/index.js";
import { defineProgram } from "../../../../src/cli/commandLibrary/contract/index.js";
import { listTodos, renameTodo } from "../support/renameTodo.js";

const program = defineProgram({
  name: "todos",
  version: "1.0.0",
  exits: { refused: 2, defect: 70 },
  commands: [renameTodo, listTodos],
});

interface FakeOptions {
  readonly argv?: ReadonlyArray<string>;
  readonly env?: Record<string, string | undefined>;
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly stdinIsTTY?: boolean;
}

function fakeProcess(options: FakeOptions = {}) {
  const reads = { count: 0 };
  const stdout = {
    isTTY: options.isTTY ?? false,
    columns: options.columns,
    write: vi.fn(),
  };
  const stderr = { write: vi.fn() };
  const stdin = Object.assign(
    Readable.from(
      (function* () {
        reads.count += 1;
        yield "hello ";
        yield "stdin";
      })(),
    ),
    options.stdinIsTTY === undefined ? {} : { isTTY: options.stdinIsTTY },
  );
  const process = {
    argv: ["node", "todos.js", ...(options.argv ?? ["rename-todo", "t1"])],
    env: options.env ?? { PATH: "/bin" },
    stdout,
    stderr,
    stdin,
  } as unknown as NodeJS.Process;
  return { process, stdout, stderr, reads };
}

describe("processIo", () => {
  it("answers the arguments after the script and the whole environment", () => {
    const io = processIo(fakeProcess().process);
    expect(io.argv).toEqual(["rename-todo", "t1"]);
    expect(io.env).toEqual({ PATH: "/bin" });
  });

  it("reads nothing from stdin for a command that declares none", async () => {
    const fake = fakeProcess({ argv: ["--version"] });
    const code = await Effect.runPromise(
      runner.run(program, processIo(fake.process)) as Effect.Effect<number>,
    );
    expect(code).toBe(0);
    expect(fake.reads.count).toBe(0);
    expect(fake.stdout.write).toHaveBeenCalled();
  });

  it("reads stdin once across two evaluations, and answers the same text", async () => {
    const fake = fakeProcess();
    const io = processIo(fake.process);
    expect(fake.reads.count).toBe(0);
    const first = await Effect.runPromise(io.stdin);
    const second = await Effect.runPromise(io.stdin);
    expect(first).toBe("hello stdin");
    expect(second).toBe(first);
    expect(fake.reads.count).toBe(1);
  });

  it("writes out to stdout and err to stderr", async () => {
    const fake = fakeProcess();
    const io = processIo(fake.process);
    await Effect.runPromise(io.out("a"));
    await Effect.runPromise(io.err("b"));
    expect(fake.stdout.write).toHaveBeenCalledExactlyOnceWith("a");
    expect(fake.stderr.write).toHaveBeenCalledExactlyOnceWith("b");
  });

  it("reports 80 columns and no colour without a terminal", () => {
    const io = processIo(fakeProcess({ columns: 120 }).process);
    expect(io.terminal).toEqual({ columns: 80, color: false });
  });

  it("takes the width and the colour from a terminal", () => {
    const io = processIo(fakeProcess({ isTTY: true, columns: 120 }).process);
    expect(io.terminal).toEqual({ columns: 120, color: true });
  });

  it("falls back to 80 columns on a terminal that reports no width", () => {
    const io = processIo(fakeProcess({ isTTY: true }).process);
    expect(io.terminal).toEqual({ columns: 80, color: true });
  });

  it("turns colour off when NO_COLOR is set", () => {
    const io = processIo(fakeProcess({ isTTY: true, env: { NO_COLOR: "" } }).process);
    expect(io.terminal.color).toBe(false);
  });

  it("reports whether stdin is a terminal, and reads none to say so", () => {
    expect(processIo(fakeProcess().process).stdinIsTerminal).toBe(false);
    const fake = fakeProcess({ stdinIsTTY: true });
    expect(processIo(fake.process).stdinIsTerminal).toBe(true);
    expect(fake.reads.count).toBe(0);
  });
});

async function inTemporaryFolder(body: (folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "cli-command-"));
  try {
    await body(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe("processIo's files", () => {
  it("reads a file's bytes", async () => {
    await inTemporaryFolder(async (folder) => {
      const path = join(folder, "in.json");
      await writeFile(path, '{"a":1}');
      const io = processIo(fakeProcess().process);
      const bytes = await Effect.runPromise(io.readFile(path));
      expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
    });
  });

  it("fails with why a file cannot be read", async () => {
    await inTemporaryFolder(async (folder) => {
      const io = processIo(fakeProcess().process);
      const why = await Effect.runPromise(Effect.flip(io.readFile(join(folder, "missing.json"))));
      expect(why).toBe("no such file or directory");
    });
  });

  it("writes a file, creating the folders above it", async () => {
    await inTemporaryFolder(async (folder) => {
      const path = join(folder, "out", "deep", "a.md");
      const io = processIo(fakeProcess().process);
      await Effect.runPromise(io.writeFile(path, new TextEncoder().encode("# a\n")));
      expect(await readFile(path, "utf8")).toBe("# a\n");
    });
  });

  it("fails with why a file cannot be written", async () => {
    await inTemporaryFolder(async (folder) => {
      const io = processIo(fakeProcess().process);
      const why = await Effect.runPromise(Effect.flip(io.writeFile(folder, new Uint8Array())));
      expect(why.length).toBeGreaterThan(0);
    });
  });
});
