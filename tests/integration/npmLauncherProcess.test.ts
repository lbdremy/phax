// The npm launcher as a process: the real file run by node with a cached fake binary (exit codes,
// forwarded signals, start errors), and full first runs through tests/fixtures/npm-launcher/drive.cjs,
// which hosts a local fixture server and calls the launcher's exported `launch`. Every home is a
// temporary directory; a spawned launcher always gets HOME set to it.
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawn, SCRIPT_BOUND_MS } from "../helpers/boundedSpawn.js";
import { LAUNCHER_SOURCE, loadLauncher } from "../helpers/launcherFixture.js";

const DRIVER = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "fixtures",
  "npm-launcher",
  "drive.cjs",
);

const launcher = loadLauncher();
const VERSION = launcher.productionConfig().version;
const NAME = launcher.getBinaryName(process.platform, process.arch);

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface World {
  readonly root: string;
  readonly home: string;
  readonly versionDir: string;
  readonly cache: string;
  readonly log: string;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), "phax-launcher-proc-"));
  temps.push(root);
  const home = join(root, "home");
  mkdirSync(home);
  const versionDir = join(home, ".phax", "bin", VERSION);
  const log = join(root, "requests.log");
  writeFileSync(log, "");
  return { root, home, versionDir, cache: join(versionDir, NAME), log };
}

function writeScript(path: string, body: string, mode = 0o755): string {
  writeFileSync(path, body);
  chmodSync(path, mode);
  return path;
}

/** A fake binary: writes "ran" to the file named by $1, then exits with $2 (0 when absent). */
function markerFake(path: string): string {
  return writeScript(path, `#!/bin/sh\necho ran > "$1"\nexit "\${2:-0}"\n`);
}

/** Places `body` at the cache path and a fresh update cache, so no request leaves. */
function placeCached(w: World, body: string, mode = 0o755): void {
  mkdirSync(w.versionDir, { recursive: true });
  writeScript(w.cache, body, mode);
  writeFileSync(
    join(w.home, ".phax", "bin", ".update-check.json"),
    JSON.stringify({ latest: VERSION, checkedAt: Date.now() }),
  );
}

function launcherEnv(w: World): NodeJS.ProcessEnv {
  return { ...process.env, HOME: w.home };
}

function runReal(w: World, args: readonly string[]) {
  return boundedSpawn(process.execPath, [LAUNCHER_SOURCE, ...args], {
    env: launcherEnv(w),
    boundMs: SCRIPT_BOUND_MS,
  });
}

function runRealSignal(w: World, args: readonly string[], signal: NodeJS.Signals) {
  return boundedSpawn(process.execPath, [LAUNCHER_SOURCE, ...args], {
    env: launcherEnv(w),
    boundMs: SCRIPT_BOUND_MS,
    expectSignal: signal,
  });
}

function driverArgs(scenario: string, w: World, fake: string, binaryArgs: readonly string[]) {
  return [DRIVER, scenario, w.home, fake, w.log, "--", ...binaryArgs];
}

function drive(scenario: string, w: World, fake: string, binaryArgs: readonly string[]) {
  return boundedSpawn(process.execPath, driverArgs(scenario, w, fake, binaryArgs), {
    env: launcherEnv(w),
    boundMs: SCRIPT_BOUND_MS,
  });
}

function driveSignal(
  scenario: string,
  w: World,
  fake: string,
  binaryArgs: readonly string[],
  signal: NodeJS.Signals,
) {
  return boundedSpawn(process.execPath, driverArgs(scenario, w, fake, binaryArgs), {
    env: launcherEnv(w),
    boundMs: SCRIPT_BOUND_MS,
    expectSignal: signal,
  });
}

function requests(w: World): { method: string; path: string }[] {
  return readFileSync(w.log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const parsed: { method: string; path: string } = JSON.parse(line);
      return parsed;
    });
}

function countPath(w: World, path: string): number {
  return requests(w).filter((request) => request.path === path).length;
}

const BINARY_PATH = `/releases/v${VERSION}/${NAME}`;
const SIDECAR_PATH = `${BINARY_PATH}.sha256`;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function downloadEntries(w: World): string[] {
  if (!existsSync(w.versionDir)) return [];
  return readdirSync(w.versionDir).filter((entry) => entry.startsWith(".download-"));
}

describe("npm launcher process: the real file with a cached binary", () => {
  it.each([0, 1, 3, 130])("passes the binary's exit code %i through", (code) => {
    const w = world();
    placeCached(w, `#!/bin/sh\nexit ${code}\n`);
    const result = runReal(w, []);
    expect(result.status).toBe(code);
  });

  it.each([
    { signal: "SIGINT" as const, status: 130, ending: null },
    { signal: "SIGTERM" as const, status: null, ending: "SIGTERM" },
    { signal: "SIGHUP" as const, status: null, ending: "SIGHUP" },
  ])("forwards $signal to the binary and ends as it ends", ({ signal, status, ending }) => {
    const w = world();
    const record = join(w.root, "signals.log");
    writeFileSync(record, "");
    // Installs its handlers, then signals its parent (the launcher) and stays alive until a
    // forwarded signal arrives.
    placeCached(
      w,
      [
        `#!${process.execPath}`,
        `const fs = require("node:fs");`,
        `const [record, under] = process.argv.slice(2);`,
        `for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {`,
        `  process.on(name, () => {`,
        `    fs.appendFileSync(record, name + "\\n");`,
        `    if (name === "SIGINT") process.exit(130);`,
        `    process.removeAllListeners(name);`,
        `    process.kill(process.pid, name);`,
        `  });`,
        `}`,
        `setInterval(() => {}, 1 << 30);`,
        `process.kill(process.ppid, under);`,
        ``,
      ].join("\n"),
    );
    const result = runRealSignal(w, [record, signal], signal);
    expect(result.status).toBe(status);
    expect(result.signal).toBe(ending);
    expect(readFileSync(record, "utf8")).toBe(`${signal}\n`);
  });

  it("dies of SIGTERM when the binary kills itself with SIGTERM", () => {
    const w = world();
    placeCached(w, "#!/bin/sh\nkill -TERM $$\n");
    const result = runRealSignal(w, [], "SIGTERM");
    expect(result.signal).toBe("SIGTERM");
  });

  it("exits 128 + n when the binary dies of SIGUSR1, without starting Node's inspector", () => {
    const w = world();
    placeCached(w, "#!/bin/sh\nkill -USR1 $$\n");
    const result = runReal(w, []);
    expect(result.status).toBe(128 + constants.signals.SIGUSR1);
    expect(result.signal).toBeNull();
    expect(result.stderr).not.toContain("Debugger");
  });

  it("reports a non-executable cache file with its path, EACCES and the remedy", () => {
    const w = world();
    placeCached(w, "#!/bin/sh\nexit 0\n", 0o644);
    const result = runReal(w, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `phax: could not start ${w.cache}: EACCES (permission denied)\n`,
    );
    expect(result.stderr).toContain(
      `  remove ${w.versionDir} and run phax again to download it afresh\n`,
    );
  });
});

describe("npm launcher start errors that spawn throws", () => {
  it("resolves an argument list too long as a start error and keeps no signal listener", async () => {
    const w = world();
    placeCached(w, "#!/bin/sh\nexit 0\n");
    const listeners = process.listenerCount("SIGINT");
    // Past ARG_MAX on macOS and past one argument's limit on Linux: spawn throws E2BIG.
    const outcome = await launcher.startBinary(w.cache, ["x".repeat(4 * 1024 * 1024)]);
    expect(outcome).toEqual({ error: { code: "E2BIG", message: expect.any(String) } });
    expect(process.listenerCount("SIGINT")).toBe(listeners);
  });
});

describe("npm launcher process: first runs through the driver", () => {
  it("runs the fake binary from a verified cache path with nothing else beside it", () => {
    const w = world();
    const fake = markerFake(join(w.root, "fake"));
    const marker = join(w.root, "marker");
    const result = drive("ok", w, fake, [marker, "0"]);
    expect(result.status).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
    expect(sha256(readFileSync(w.cache))).toBe(sha256(readFileSync(fake)));
    expect(readdirSync(w.versionDir)).toEqual([NAME]);
    expect(countPath(w, BINARY_PATH)).toBe(1);
    expect(countPath(w, SIDECAR_PATH)).toBe(1);
  });

  it("refuses a mismatching sidecar and leaves nothing", () => {
    const w = world();
    const fake = markerFake(join(w.root, "fake"));
    const marker = join(w.root, "marker");
    const result = drive("mismatch", w, fake, [marker, "0"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`phax: checksum mismatch for ${NAME}`);
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(w.cache)).toBe(false);
    expect(downloadEntries(w)).toEqual([]);
  });

  it.each(["SIGINT", "SIGTERM", "SIGHUP"] as const)(
    "a %s during the download ends the launcher by it and leaves nothing; the next run succeeds",
    (signal) => {
      const w = world();
      const fake = markerFake(join(w.root, "fake"));
      const marker = join(w.root, "marker");
      const stalled = driveSignal(`stall-${signal}`, w, fake, [marker, "0"], signal);
      expect(stalled.stderr).toMatch(/drive: partial file holds [1-9]\d* bytes\n/);
      expect(stalled.signal).toBe(signal);
      expect(downloadEntries(w)).toEqual([]);
      expect(existsSync(w.cache)).toBe(false);
      expect(existsSync(marker)).toBe(false);

      writeFileSync(w.log, "");
      const next = drive("ok", w, fake, [marker, "0"]);
      expect(next.status).toBe(0);
      expect(countPath(w, BINARY_PATH)).toBe(1);
      expect(countPath(w, SIDECAR_PATH)).toBe(1);
      expect(readFileSync(marker, "utf8")).toBe("ran\n");
    },
  );

  it("two concurrent first runs both run a verified binary", () => {
    const w = world();
    const fake = markerFake(join(w.root, "fake"));
    const marker = join(w.root, "marker");
    const result = drive("concurrent", w, fake, [marker, "7"]);
    expect(result.status).toBe(0);
    const outcomes: unknown = JSON.parse(result.stdout.trim());
    expect(outcomes).toEqual([
      { code: 7, signal: null },
      { code: 7, signal: null },
    ]);
    expect(countPath(w, BINARY_PATH)).toBe(2);
    expect(countPath(w, SIDECAR_PATH)).toBe(2);
    expect(sha256(readFileSync(w.cache))).toBe(sha256(readFileSync(fake)));
    expect(downloadEntries(w)).toEqual([]);
  });

  it("runs a cached binary without any request", () => {
    const w = world();
    const fake = markerFake(join(w.root, "fake"));
    placeCached(w, readFileSync(fake, "utf8"));
    const marker = join(w.root, "marker");
    const result = drive("cached", w, fake, [marker, "0"]);
    expect(result.status).toBe(0);
    expect(requests(w)).toEqual([]);
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
  });

  it("does not wait for an update endpoint that never answers", () => {
    const w = world();
    const fake = markerFake(join(w.root, "fake"));
    mkdirSync(w.versionDir, { recursive: true });
    writeScript(w.cache, readFileSync(fake, "utf8"));
    const marker = join(w.root, "marker");
    // The bound is far below the injected 10-minute update timeout.
    const result = drive("update-stall", w, fake, [marker, "0"]);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("update");
    expect(readFileSync(marker, "utf8")).toBe("ran\n");
  });

  it("reports a vanished cache path with its path, ENOENT and the remedy", () => {
    const w = world();
    const fake = markerFake(join(w.root, "fake"));
    const result = drive("vanish", w, fake, []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `phax: could not start ${w.cache}: ENOENT (no such file or directory)\n`,
    );
    expect(result.stderr).toContain(
      `  remove ${w.versionDir} and run phax again to download it afresh\n`,
    );
  });
});
