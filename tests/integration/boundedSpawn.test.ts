import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  boundedOutput,
  boundedSpawn,
  BoundedSpawnError,
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  cliArgs,
} from "../helpers/boundedSpawn.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

const repoRoot = join(fileURLToPath(import.meta.url), "../../..");
const work = mkdtempSync(join(tmpdir(), "phax-bounded-spawn-test-"));
const pids = join(work, "pids");
mkdirSync(pids);

// A node one-liner answers in well under a second: 20 s leaves room under a loaded gate.
const SCRIPT_MS = 20_000;

/** Write a script into the work directory and return its path. */
function script(name: string, body: string): string {
  const path = join(work, name);
  writeFileSync(path, body);
  return path;
}

/** Record a pid the file started, for the survivor probe in `afterAll`. */
function recordPid(name: string, pid: number): void {
  writeFileSync(join(pids, `${name}.pid`), String(pid));
}

function readPid(name: string): number {
  return Number(readFileSync(join(pids, `${name}.pid`), "utf8"));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** Whether `pid` is gone within `ms`: a killed orphan is reaped by init a moment after it dies. */
async function goneWithin(pid: number, ms = 5_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (isAlive(pid)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/** The error a call throws, which must be a BoundedSpawnError. */
function thrown(call: () => unknown): BoundedSpawnError {
  try {
    call();
  } catch (error) {
    if (error instanceof BoundedSpawnError) return error;
    throw error;
  }
  throw new Error("the call did not throw");
}

// Every pid a case recorded must be gone: a survivor is killed, then fails the file.
afterAll(async () => {
  const survivors: string[] = [];
  for (const file of readdirSync(pids)) {
    const pid = Number(readFileSync(join(pids, file), "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (await goneWithin(pid, 2_000)) continue;
    survivors.push(`${file.replace(/\.pid$/, "")} (pid ${pid})`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ended meanwhile
    }
  }
  removeTempDir(work);
  expect(survivors, "processes left behind by the bounded spawn").toEqual([]);
});

describe("boundedSpawn", () => {
  it("ends a child and a grandchild that ignore SIGTERM at the bound, naming it (ac-ignores-sigterm)", async () => {
    const grandchild = script(
      "grandchild.mjs",
      `import { writeFileSync, writeSync } from "node:fs";
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(join(pids, "grandchild.pid"))}, String(process.pid));
writeSync(2, "grandchild: up\\n");
setInterval(() => {}, 1000);
`,
    );
    const child = script(
      "child.mjs",
      `import { spawn } from "node:child_process";
import { writeFileSync, writeSync } from "node:fs";
process.on("SIGTERM", () => {});
writeFileSync(${JSON.stringify(join(pids, "child.pid"))}, String(process.pid));
spawn(process.execPath, [${JSON.stringify(grandchild)}], { stdio: "inherit" });
writeSync(1, "child: started a grandchild\\n");
setInterval(() => {}, 1000);
`,
    );

    const started = performance.now();
    const error = thrown(() => boundedSpawn(process.execPath, [child], { boundMs: 2_000 }));
    const elapsed = performance.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(2_000);
    expect(elapsed).toBeLessThan(2_000 + 2_000 + 3_000);
    expect(error.message).toContain(
      `\`node ${child}\` reached its bound (2000 ms) and was ended by it`,
    );
    expect(error.message).toContain("SIGKILL to it and 1 descendant");
    expect(error.message).toContain("child: started a grandchild");
    expect(error.message).toContain("grandchild: up");
    expect(error.childPid).toBe(readPid("child"));
    expect(await goneWithin(readPid("child"))).toBe(true);
    expect(await goneWithin(readPid("grandchild"))).toBe(true);
  });

  it("ends a hung CLI spawn, its node process and its usage child at the bound (ac-cli-hang)", async () => {
    // phax completions runs `usage generate completion` from PATH: this one never answers.
    const bin = join(work, "fake-usage-bin");
    mkdirSync(bin);
    const usage = join(bin, "usage");
    writeFileSync(
      usage,
      `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(join(pids, "usage.pid"))}, String(process.pid));
writeFileSync(${JSON.stringify(join(pids, "cli-node.pid"))}, String(process.ppid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`,
    );
    chmodSync(usage, 0o755);
    const path = [
      bin,
      join(repoRoot, "node_modules", ".bin"),
      dirname(process.execPath),
      "/usr/bin",
      "/bin",
    ].join(":");

    const error = thrown(() =>
      boundedSpawn(CLI_LAUNCHER, cliArgs("completions", "zsh"), {
        // Long enough for the CLI to load and reach its usage child under a loaded gate.
        boundMs: 30_000,
        env: { ...phaxHomeEnv(), PATH: path },
      }),
    );
    if (error.childPid !== undefined) recordPid("tsx", error.childPid);

    expect(error.message).toContain(
      "`tsx src/cli/main.ts completions zsh` reached its bound (30000 ms) and was ended by it",
    );
    expect(error.childPid).toBeDefined();
    const usagePid = readPid("usage");
    const nodePid = readPid("cli-node");
    expect(nodePid).not.toBe(error.childPid);
    expect(await goneWithin(usagePid)).toBe(true);
    expect(await goneWithin(nodePid)).toBe(true);
    expect(await goneWithin(error.childPid ?? 0)).toBe(true);
  });

  it("gives a foreign signal a diagnosis block and one line in PHAX_SPAWN_DIAG_LOG", () => {
    const child = script(
      "diag-term.mjs",
      `process.kill(process.pid, "SIGTERM");
setInterval(() => {}, 1000);
`,
    );
    const log = join(work, "diag.jsonl");
    const before = process.env["PHAX_SPAWN_DIAG_LOG"];
    process.env["PHAX_SPAWN_DIAG_LOG"] = log;
    let error: BoundedSpawnError;
    try {
      error = thrown(() => boundedSpawn(process.execPath, [child], { boundMs: SCRIPT_MS }));
    } finally {
      if (before === undefined) delete process.env["PHAX_SPAWN_DIAG_LOG"];
      else process.env["PHAX_SPAWN_DIAG_LOG"] = before;
    }
    expect(error.childPid).toBeGreaterThan(0);
    const message = error.message;
    expect(message).toContain("diagnosis:");
    expect(message).toContain(`worker: pid ${process.pid}`);
    expect(message).toContain(`child: pid ${error.childPid}`);
    expect(message).toContain("sender: not reported by the platform");
    expect(message.indexOf("stderr (")).toBeLessThan(message.indexOf("diagnosis:"));

    const lines = readFileSync(log, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const entry: { ending: string; signal: string; child: { pid: number }; moment: string } =
      JSON.parse(lines[0] ?? "");
    expect(entry.ending).toBe("signal");
    expect(entry.signal).toBe("SIGTERM");
    expect(entry.child.pid).toBe(error.childPid);
    expect(Number.isNaN(Date.parse(entry.moment))).toBe(false);
  });

  it("fails a child that SIGTERMs itself, naming the signal and its output (ac-foreign-signal)", () => {
    const child = script(
      "self-term.mjs",
      `import { writeSync } from "node:fs";
writeSync(2, "self-term: about to end\\n");
process.kill(process.pid, "SIGTERM");
setInterval(() => {}, 1000);
`,
    );
    const error = thrown(() => boundedSpawn(process.execPath, [child], { boundMs: SCRIPT_MS }));
    expect(error.message).toContain(
      `\`node ${child}\` ended by SIGTERM, not by its bound (${SCRIPT_MS} ms)`,
    );
    expect(error.message).toContain("stderr (24 bytes): self-term: about to end");
  });

  it("returns a normal exit even when a process outside the group holds the pipes", async () => {
    // A detached grandchild has a group of its own, out of the bound's reach (an accepted loss),
    // and inherits the child's pipes: the call must not wait for it.
    const holder = script(
      "holder.mjs",
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(pids, "holder.pid"))}, String(process.pid));
setInterval(() => {}, 1000);
`,
    );
    const child = script(
      "leaves-holder.mjs",
      `import { spawn } from "node:child_process";
import { existsSync, writeSync } from "node:fs";
spawn(process.execPath, [${JSON.stringify(holder)}], { detached: true, stdio: "inherit" }).unref();
while (!existsSync(${JSON.stringify(join(pids, "holder.pid"))})) await new Promise((r) => setTimeout(r, 10));
writeSync(1, "child: left a holder\\n");
process.exit(0);
`,
    );
    const started = performance.now();
    let result: ReturnType<typeof boundedSpawn>;
    try {
      result = boundedSpawn(process.execPath, [child], { boundMs: SCRIPT_MS });
    } finally {
      try {
        process.kill(readPid("holder"), "SIGKILL");
      } catch {
        // never started, or ended meanwhile
      }
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("child: left a holder\n");
    expect(performance.now() - started).toBeLessThan(SCRIPT_MS);
    expect(await goneWithin(readPid("holder"))).toBe(true);
  });

  it("fails a CLI spawn whose node process is SIGTERMed, relayed by tsx as 143 (ac-relayed-143)", () => {
    // Loaded into tsx's process too, through NODE_OPTIONS: only the CLI's node process acts.
    const preload = script(
      "sigterm-preload.mjs",
      `import { writeSync } from "node:fs";
if ((process.argv[1] ?? "").endsWith("src/cli/main.ts")) {
  writeSync(1, "preload: loaded\\n");
  writeSync(2, "preload: sending SIGTERM\\n");
  process.kill(process.pid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
`,
    );
    const error = thrown(() =>
      boundedSpawn(CLI_LAUNCHER, cliArgs("--version"), {
        boundMs: CLI_BOUND_MS,
        env: { ...phaxHomeEnv(), NODE_OPTIONS: `--import ${pathToFileURL(preload).href}` },
      }),
    );
    expect(error.message).toContain(
      `\`tsx src/cli/main.ts --version\` ended by SIGTERM, not by its bound (${CLI_BOUND_MS} ms)`,
    );
    expect(error.message).toContain("sent through tsx: exit status 143");
    expect(error.message).toContain("stdout (16 bytes): preload: loaded");
    expect(error.message).toContain("stderr (25 bytes): preload: sending SIGTERM");
  });

  it("returns an expected signal as a result, and still fails another (ac-expected-signal)", () => {
    const sigint = script(
      "self-int.mjs",
      `import { writeSync } from "node:fs";
writeSync(1, "out\\n");
writeSync(2, "err\\n");
process.kill(process.pid, "SIGINT");
setInterval(() => {}, 1000);
`,
    );
    expect(
      boundedSpawn(process.execPath, [sigint], { boundMs: SCRIPT_MS, expectSignal: "SIGINT" }),
    ).toEqual({ status: null, signal: "SIGINT", stdout: "out\n", stderr: "err\n" });

    const sigterm = script(
      "self-term-unexpected.mjs",
      `process.kill(process.pid, "SIGTERM");
setInterval(() => {}, 1000);
`,
    );
    const error = thrown(() =>
      boundedSpawn(process.execPath, [sigterm], { boundMs: SCRIPT_MS, expectSignal: "SIGINT" }),
    );
    expect(error.message).toContain("ended by SIGTERM, not by its bound");
  });

  it("returns a refused CLI call's exit 64 and a child's exact bytes unchanged (ac-normal-exit)", () => {
    const refused = boundedSpawn(CLI_LAUNCHER, cliArgs("ls", "--no-such-option"), {
      boundMs: CLI_BOUND_MS,
      env: phaxHomeEnv(),
    });
    expect(refused.status).toBe(64);
    expect(refused.signal).toBeNull();
    expect(refused.stderr).toContain("--no-such-option");

    const child = script(
      "exit-64.mjs",
      `import { writeSync } from "node:fs";
writeSync(1, "alpha\\nbéta");
writeSync(2, "gamma\\n\\n");
process.exit(64);
`,
    );
    expect(boundedSpawn(process.execPath, [child], { boundMs: SCRIPT_MS })).toEqual({
      status: 64,
      signal: null,
      stdout: "alpha\nbéta",
      stderr: "gamma\n\n",
    });
  });

  it("starts the child from the calling process itself, with no process in between", () => {
    // A supervisor process per call cost ~50 ms, about 15 minutes over the suite's git calls.
    const result = boundedSpawn(
      process.execPath,
      ["-e", "process.stdout.write(String(process.ppid))"],
      {
        boundMs: SCRIPT_MS,
      },
    );
    expect(result.stdout).toBe(String(process.pid));
  });

  it("passes input on stdin, and an empty closed stdin without it", () => {
    const echo = script("echo.mjs", `process.stdin.pipe(process.stdout);\n`);
    expect(
      boundedSpawn(process.execPath, [echo], { boundMs: SCRIPT_MS, input: "hello" }).stdout,
    ).toBe("hello");
    expect(boundedSpawn(process.execPath, [echo], { boundMs: SCRIPT_MS }).stdout).toBe("");
  });

  it("refuses a call with no usable bound before any child starts (ac-bound-missing)", () => {
    const marker = join(work, "bound-missing.marker");
    const args = ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran")`];
    const calls: (() => unknown)[] = [
      // The type check bypassed: a call with no boundMs at all.
      () => {
        Reflect.apply(boundedSpawn, undefined, [process.execPath, args, {}]);
      },
      () => boundedSpawn(process.execPath, args, { boundMs: 0 }),
      () => boundedSpawn(process.execPath, args, { boundMs: Number.NaN }),
      () => boundedSpawn(process.execPath, args, { boundMs: Number.POSITIVE_INFINITY }),
    ];
    for (const call of calls) {
      expect(call).toThrow(/^bounded spawn: `node -e .*` needs a bound: boundMs is required/);
    }
    expect(existsSync(marker)).toBe(false);
  });

  it("fails a command that cannot start, naming it", () => {
    const missing = join(work, "no-such-command");
    expect(thrown(() => boundedSpawn(missing, [], { boundMs: SCRIPT_MS })).message).toContain(
      `\`${missing}\` could not start`,
    );
  });
});

describe("boundedOutput", () => {
  it("returns stdout on status 0", () => {
    const ok = script("ok.mjs", `process.stdout.write("hello\\n");\n`);
    expect(boundedOutput(process.execPath, [ok], { boundMs: SCRIPT_MS })).toBe("hello\n");
  });

  it("throws naming the command, the status and stderr otherwise", () => {
    const failing = script(
      "fails.mjs",
      `import { writeSync } from "node:fs";
writeSync(2, "nope: it failed\\n");
process.exit(3);
`,
    );
    const error = thrown(() => boundedOutput(process.execPath, [failing], { boundMs: SCRIPT_MS }));
    expect(error.message).toContain(`\`node ${failing}\` exited with status 3, not 0`);
    expect(error.message).toContain("nope: it failed");
  });
});
