import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Result } from "effect";
import { resolvePhaxHome } from "../../src/app/phaxHome.js";
import { runHomeFile } from "../../src/domain/phaxHome.js";
import { decodeRunHome, type RunHome } from "../../src/schemas/runHome.js";

// A run folder a test builds by hand holds the phax home record `phax run` writes
// (createRunFolder): `phax resume`, and the commands that open a session for the run, refuse a
// run without one. Written from the home resolved now, as createRunFolder does, so it is the
// isolated home of a suite that calls isolatePhaxHome() first.

/** The home path `<runPath>/phax-home.json` records: what the run's sessions get as PHAX_HOME. */
export function recordedRunHome(runPath: string): string {
  const raw: unknown = JSON.parse(readFileSync(runHomeFile(runPath), "utf8"));
  return Result.getOrThrow(decodeRunHome(raw)).path;
}

/** Writes `<runPath>/phax-home.json` holding `home`, or the home resolved now; answers it. */
export function writeRunHomeRecord(runPath: string, home?: RunHome): RunHome {
  const recorded = home ?? Result.getOrThrow(resolvePhaxHome());
  mkdirSync(runPath, { recursive: true });
  writeFileSync(
    runHomeFile(runPath),
    JSON.stringify({ path: recorded.path, from: recorded.from }, null, 2),
  );
  return recorded;
}
