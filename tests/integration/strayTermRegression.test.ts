// The stray SIGTERM behind the exit-143 kills of 2026-11-19 and 2026-11-20
// (spikes/bounded-test-spawns/findings.md). Its sender was the test's own `spawnSync`: with its
// default `maxBuffer` (1 MiB), Node ends the read with ENOBUFS once a child prints more, and sends
// `killSignal` (SIGTERM) to the direct child, tsx. tsx relays it to the process it runs (phax),
// which the test never started, and exits 143 when that process has not ended within its 30 ms
// windows. The root `phax --json-schema` has printed more than 1 MiB since b9fe0324.
//
// The bounded spawn reads a child's output with no cap, so no output size makes it signal
// anything. This file drives the path the sender took: a child run through `CLI_LAUNCHER` that
// prints more than 1 MiB, and asserts that the process tsx runs receives no signal. On the code
// before phase-02 (a plain `spawnSync` with no `maxBuffer`) the 3 MiB case fails every time,
// without any load: the relayed SIGTERM reaches the script and its marker records it.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  boundedSpawn,
  CLI_BOUND_MS,
  CLI_LAUNCHER,
  cliArgs,
  SCRIPT_BOUND_MS,
} from "../helpers/boundedSpawn.js";
import { phaxHomeEnv } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

/** Node's default `maxBuffer` for spawnSync and execFileSync: the cap the sender enforced. */
const NODE_MAX_BUFFER = 1024 * 1024;
const PRINTED_BYTES = 3 * NODE_MAX_BUFFER;

const work = mkdtempSync(join(tmpdir(), "phax-stray-term-"));

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

// Every pid a case recorded must be gone, even after a failed assertion: a survivor is killed,
// then fails the file.
afterAll(async () => {
  const survivors: number[] = [];
  for (const file of readdirSync(work).filter((name) => name.endsWith(".pid"))) {
    const pid = Number(readFileSync(join(work, file), "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const deadline = Date.now() + 2_000;
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!isAlive(pid)) continue;
    survivors.push(pid);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ended meanwhile
    }
  }
  removeTempDir(work);
  expect(survivors, "processes left behind by the regression test").toEqual([]);
});

describe("the stray SIGTERM's path: a launched child printing more than 1 MiB", () => {
  it("the process tsx runs receives no signal, and its whole output and exit 0 come back", () => {
    const marker = join(work, "signalled");
    const pidFile = join(work, "printer.pid");
    // Prints 3 MiB, then lingers 500 ms before exiting 0: long enough for a relayed signal to
    // arrive after tsx's 30 ms window. A signal it receives is written to the marker.
    const printer = join(work, "printer.mjs");
    writeFileSync(
      printer,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    writeFileSync(${JSON.stringify(marker)}, signal);
    process.exit(0);
  });
}
// A reader that stops reading must not end it before a signal can.
process.stdout.on("error", () => undefined);
const line = "x".repeat(1023) + "\\n";
process.stdout.write(line.repeat(${PRINTED_BYTES / 1024}), () => {
  setTimeout(() => process.exit(0), 500);
});
`,
    );

    const result = boundedSpawn(CLI_LAUNCHER, [printer], { boundMs: SCRIPT_BOUND_MS });

    expect({
      signalled: existsSync(marker) ? readFileSync(marker, "utf8") : null,
      status: result.status,
      bytes: Buffer.byteLength(result.stdout, "utf8"),
    }).toEqual({ signalled: null, status: 0, bytes: PRINTED_BYTES });
  });

  it("the root --json-schema, the call killed on record, exits 0 with its whole catalogue", () => {
    const result = boundedSpawn(CLI_LAUNCHER, cliArgs("--json-schema"), {
      boundMs: CLI_BOUND_MS,
      env: phaxHomeEnv(),
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    // Over the cap, which is what made the sender signal: if the catalogue shrinks under it, this
    // case stops covering the path, and the 3 MiB case above still does.
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeGreaterThan(NODE_MAX_BUFFER);
    expect(() => JSON.parse(result.stdout) as unknown).not.toThrow();
  });
});
